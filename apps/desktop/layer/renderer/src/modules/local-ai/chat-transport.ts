import type { ChatTransport, UIMessageChunk } from "ai"
import { createUIMessageStream } from "ai"
import { t } from "i18next"
import { nanoid } from "nanoid"

import { getLocalAIProvider } from "~/atoms/local-ai"
import { getAISettings } from "~/atoms/settings/ai"
import { AIPersistService } from "~/modules/ai-chat/services"
import type { BizUIMessage } from "~/modules/ai-chat/store/types"
import { createChatStreamTimeout } from "~/modules/ai-chat/utils/chat-stream-timeout"
import { withInactivityTimeout } from "~/modules/ai-chat/utils/stream-timeout"

import type { LocalAIMessage } from "./bridge"
import { streamLocalChat } from "./bridge"
import { buildLocalChatMessages, buildLocalSystemPrompt } from "./prompt"
import { generateLocalChatTitle } from "./tasks"

/** Same shape as the title handler the official transport receives */
export interface LocalChatTitleHandler {
  chatId?: string
  shouldHandle?: () => boolean
  onTitleChange?: (title: string) => void
  persist?: boolean | ((title: string) => void | Promise<void>)
}

/**
 * A chat transport that answers straight from the provider configured in the settings instead of
 * the Folo API.
 *
 * The reply is produced as the same `UIMessageChunk` stream the backend sends, so the rest of the
 * chat (persistence, rendering, reasoning sections) needs no knowledge of where it came from.
 */
export class LocalChatTransport implements ChatTransport<BizUIMessage> {
  constructor(private readonly options: { titleHandler?: LocalChatTitleHandler } = {}) {}

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<BizUIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const provider = getLocalAIProvider()
    if (!provider) {
      throw new Error("还没有配置本机 AI 服务商，请到设置 - AI 中填写。")
    }

    const history = await buildLocalChatMessages(messages)
    const systemPrompt = buildLocalSystemPrompt({
      personalizePrompt: getAISettings().personalizePrompt,
    })
    const payload: LocalAIMessage[] = [{ role: "system", content: systemPrompt }, ...history]
    // The backend titles a chat with its first answer; locally the same rule is applied here
    const shouldTitle = messages.every((message) => message.role !== "assistant")

    const stream = createUIMessageStream<BizUIMessage>({
      onError: (error) => (error instanceof Error ? error.message : String(error)),
      execute: async ({ writer }) => {
        writer.write({ type: "start" })

        let textId: string | null = null
        let reasoningId: string | null = null

        const closeOpenParts = () => {
          if (reasoningId) {
            writer.write({ type: "reasoning-end", id: reasoningId })
            reasoningId = null
          }
          if (textId) {
            writer.write({ type: "text-end", id: textId })
            textId = null
          }
        }

        try {
          for await (const event of streamLocalChat(provider, payload, abortSignal)) {
            if (event.type === "text") {
              if (!textId) {
                textId = nanoid()
                writer.write({ type: "text-start", id: textId })
              }
              writer.write({ type: "text-delta", id: textId, delta: event.delta })
              continue
            }

            if (event.type === "reasoning") {
              if (!reasoningId) {
                reasoningId = nanoid()
                writer.write({ type: "reasoning-start", id: reasoningId })
              }
              writer.write({ type: "reasoning-delta", id: reasoningId, delta: event.delta })
              continue
            }

            if (event.type === "error") {
              throw new Error(event.message)
            }

            break
          }

          closeOpenParts()
          writer.write({ type: "finish", finishReason: "stop" })
        } catch (error) {
          closeOpenParts()
          throw error
        }

        if (shouldTitle) {
          void this.updateTitle(history)
        }
      },
    })

    // A provider that stops sending would otherwise leave the reply pending forever
    return withInactivityTimeout(
      stream,
      createChatStreamTimeout(),
      () => new Error(t("chat.error.stream_timeout", { ns: "ai" })),
    )
  }

  /** A local reply has no server side state to reconnect to */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  private async updateTitle(messages: LocalAIMessage[]) {
    const { titleHandler } = this.options
    if (!titleHandler) return
    if (!(titleHandler.shouldHandle?.() ?? true)) return

    try {
      const title = await generateLocalChatTitle(messages)
      if (!title) return

      titleHandler.onTitleChange?.(title)

      const persistOption = titleHandler.persist
      const shouldPersist = persistOption === undefined ? true : persistOption
      if (!shouldPersist) return

      if (typeof persistOption === "function") {
        await persistOption(title)
        return
      }

      if (titleHandler.chatId) {
        await AIPersistService.updateSessionTitle(titleHandler.chatId, title)
      }
    } catch (error) {
      console.error("Failed to generate the local chat title:", error)
    }
  }
}
