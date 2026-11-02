import { IN_ELECTRON } from "@follow/shared/constants"
import { nanoid } from "nanoid"

import type { LocalAIProviderConfig } from "~/atoms/local-ai"
import { ipcServices } from "~/lib/client"

/** Must match the channel the main process sends stream events on */
const AI_STREAM_CHANNEL = "ai-stream"

export type LocalAIStreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "error"; message: string }
  | { type: "done" }

export interface LocalAIMessage {
  role: "system" | "user" | "assistant"
  content: string
}

interface LocalAIStreamPayload {
  requestId: string
  event: LocalAIStreamEvent
}

const createEventQueue = <T>() => {
  const buffer: T[] = []
  let pending: ((result: IteratorResult<T>) => void) | null = null
  let closed = false

  const flush = () => {
    if (!pending) return
    if (buffer.length > 0) {
      const resolve = pending
      pending = null
      resolve({ value: buffer.shift()!, done: false })
      return
    }
    if (closed) {
      const resolve = pending
      pending = null
      resolve({ value: undefined as never, done: true })
    }
  }

  return {
    push(value: T) {
      buffer.push(value)
      flush()
    },
    close() {
      closed = true
      flush()
    },
    next: () => {
      return new Promise<IteratorResult<T>>((resolve) => {
        pending = resolve
        flush()
      })
    },
  }
}

/** Local AI calls go through the main process, which is the only side that can reach a provider */
export const canUseLocalAI = () => IN_ELECTRON && !!ipcServices?.ai

const toRequest = (provider: LocalAIProviderConfig, messages: LocalAIMessage[]) => ({
  baseURL: provider.baseURL,
  apiKey: provider.apiKey || null,
  headers: provider.headers ?? null,
  model: provider.model,
  messages,
})

/**
 * Streams a reply from the configured provider.
 * Yields text and reasoning deltas, then ends. Provider failures arrive as an `error` event
 * followed by the end of the stream, so callers only need to handle a single failure path.
 */
export async function* streamLocalChat(
  provider: LocalAIProviderConfig,
  messages: LocalAIMessage[],
  abortSignal?: AbortSignal,
): AsyncGenerator<LocalAIStreamEvent> {
  if (!canUseLocalAI()) {
    yield { type: "error", message: "本机 AI 只能在桌面客户端内使用。" }
    return
  }

  const requestId = nanoid()
  const queue = createEventQueue<LocalAIStreamEvent>()

  const electron = window.electron
  if (!electron) {
    yield { type: "error", message: "本机 AI 只能在桌面客户端内使用。" }
    return
  }

  const dispose = electron.ipcRenderer.on(
    AI_STREAM_CHANNEL,
    (_event, payload: LocalAIStreamPayload) => {
      if (payload?.requestId !== requestId) return
      queue.push(payload.event)
    },
  )

  const handleAbort = () => {
    void ipcServices?.ai?.abortChat({ requestId })
  }
  abortSignal?.addEventListener("abort", handleAbort)

  const request = ipcServices!.ai.streamChat({ requestId, ...toRequest(provider, messages) })

  void request
    .catch((error: unknown) => {
      queue.push({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      queue.close()
    })

  try {
    while (true) {
      const { value, done } = await queue.next()
      if (done) return
      yield value
    }
  } finally {
    abortSignal?.removeEventListener("abort", handleAbort)
    dispose()
    // The consumer stopped reading, so the provider request is stopped as well
    void ipcServices?.ai?.abortChat({ requestId })
  }
}

/** One shot completion, for the features that only need the finished text */
export const completeLocalChat = async (
  provider: LocalAIProviderConfig,
  messages: LocalAIMessage[],
): Promise<string> => {
  if (!canUseLocalAI()) {
    throw new Error("本机 AI 只能在桌面客户端内使用。")
  }

  const result = await ipcServices!.ai.complete(toRequest(provider, messages))
  return result.text
}
