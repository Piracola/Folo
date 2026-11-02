import { net } from "electron"
import { getIpcContext, IpcMethod, IpcService } from "electron-ipc-decorator"

import { logger } from "~/logger"

/** Channel the renderer listens on while a local AI reply is streaming */
export const AI_STREAM_CHANNEL = "ai-stream"

export type AIStreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "error"; message: string }
  | { type: "done" }

export interface AIMessagePayload {
  role: "system" | "user" | "assistant"
  content: string
}

export interface AIChatRequest {
  baseURL: string
  apiKey?: string | null
  headers?: Record<string, string> | null
  model: string
  messages: AIMessagePayload[]
  temperature?: number | null
}

export interface AIStreamChatInput extends AIChatRequest {
  requestId: string
}

export interface AICompleteInput extends AIChatRequest {
  maxTokens?: number | null
}

export interface AICompleteResult {
  text: string
}

/** A one shot completion that takes longer than this is treated as a dead connection */
const COMPLETE_TIMEOUT = 60_000

/**
 * The endpoint an OpenAI compatible provider streams chat completions from.
 * A pasted URL that already ends with `/chat/completions` is kept as it is.
 */
const buildCompletionsURL = (baseURL: string) => {
  const base = baseURL.trim().replace(/\/+$/, "")
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`
}

const buildHeaders = (input: AIChatRequest, stream: boolean): Record<string, string> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: stream ? "text/event-stream" : "application/json",
  }
  const apiKey = input.apiKey?.trim()
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }
  return { ...headers, ...input.headers }
}

const buildBody = (input: AIChatRequest, stream: boolean) => {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream,
  }
  if (typeof input.temperature === "number") {
    body.temperature = input.temperature
  }
  return JSON.stringify(body)
}

/** The provider's own explanation of a failed request, when it sends one */
const readFailureMessage = async (response: Response) => {
  let text = ""
  try {
    text = (await response.text()).slice(0, 800)
  } catch {
    // The body may already be consumed or the connection may have dropped
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = parsed?.error?.message ?? parsed?.message
    if (typeof message === "string" && message.trim()) return message
  } catch {
    // Not JSON, fall through to the raw text
  }

  return text.trim() || `HTTP ${response.status} ${response.statusText}`.trim()
}

const extractDeltaText = (chunk: unknown) => {
  const delta = (chunk as { choices?: { delta?: Record<string, unknown> }[] })?.choices?.[0]?.delta
  if (!delta) return { text: "", reasoning: "" }

  const text = typeof delta.content === "string" ? delta.content : ""
  const reasoning =
    typeof delta.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta.reasoning === "string"
        ? delta.reasoning
        : ""

  return { text, reasoning }
}

const extractChunkError = (chunk: unknown) => {
  const error = (chunk as { error?: { message?: unknown } | string })?.error
  if (!error) return null
  if (typeof error === "string") return error
  return typeof error.message === "string" ? error.message : JSON.stringify(error)
}

export class AiService extends IpcService {
  static override readonly groupName = "ai"

  private controllers = new Map<string, AbortController>()

  /**
   * Calls the provider directly from this device and forwards the reply to the window that asked
   * for it. Nothing but the chunks crosses the process boundary, so the renderer never needs a
   * CORS friendly endpoint.
   */
  @IpcMethod()
  async streamChat(input: AIStreamChatInput): Promise<void> {
    const { sender } = getIpcContext()
    const send = (event: AIStreamEvent) => {
      if (sender.isDestroyed()) return
      sender.send(AI_STREAM_CHANNEL, { requestId: input.requestId, event })
    }

    const controller = new AbortController()
    this.controllers.set(input.requestId, controller)

    try {
      logger.info("[AI] streaming chat completion", {
        baseURL: input.baseURL,
        model: input.model,
        messages: input.messages.length,
      })

      const response = await net.fetch(buildCompletionsURL(input.baseURL), {
        method: "POST",
        credentials: "omit",
        headers: buildHeaders(input, true),
        body: buildBody(input, true),
        signal: controller.signal,
      })

      if (!response.ok) {
        send({ type: "error", message: await readFailureMessage(response) })
        return
      }

      if (!response.body) {
        send({ type: "error", message: "The provider returned an empty response." })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let receivedDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Server sent events are separated by newlines, so only complete lines are handled and the
        // trailing partial line waits for the next read.
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line.startsWith("data:")) continue

          const payload = line.slice(5).trim()
          if (!payload) continue

          // Gateways often keep the connection open after the terminator, so the reply ends here
          // rather than waiting for the socket to close.
          if (payload === "[DONE]") {
            receivedDone = true
            break
          }

          let chunk: unknown
          try {
            chunk = JSON.parse(payload)
          } catch {
            continue
          }

          const chunkError = extractChunkError(chunk)
          if (chunkError) {
            send({ type: "error", message: chunkError })
            return
          }

          const { text, reasoning } = extractDeltaText(chunk)
          if (reasoning) send({ type: "reasoning", delta: reasoning })
          if (text) send({ type: "text", delta: text })
        }

        if (receivedDone) {
          await reader.cancel().catch(() => {})
          break
        }
      }

      send({ type: "done" })
    } catch (error) {
      if (controller.signal.aborted) {
        send({ type: "done" })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      logger.error("[AI] streaming chat completion failed", { message })
      send({ type: "error", message })
    } finally {
      this.controllers.delete(input.requestId)
    }
  }

  /** Stops the reply the window started with this id, if it is still running */
  @IpcMethod()
  abortChat(input: { requestId: string }): void {
    this.controllers.get(input.requestId)?.abort()
    this.controllers.delete(input.requestId)
  }

  /**
   * One shot completion, used by the features that only need the finished text such as the entry
   * summary and the chat title.
   */
  @IpcMethod()
  async complete(input: AICompleteInput): Promise<AICompleteResult> {
    const controller = new AbortController()
    // A dead provider must not leave the settings test or a summary card pending forever
    const timeout = setTimeout(() => controller.abort(), COMPLETE_TIMEOUT)

    try {
      const response = await net.fetch(buildCompletionsURL(input.baseURL), {
        method: "POST",
        credentials: "omit",
        headers: buildHeaders(input, false),
        body: buildBody(input, false),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(await readFailureMessage(response))
      }

      const json = (await response.json()) as {
        choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[]
      }
      const content = json?.choices?.[0]?.message?.content
      return { text: typeof content === "string" ? content : "" }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `The provider did not answer within ${Math.round(COMPLETE_TIMEOUT / 1000)} seconds.`,
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  }
}
