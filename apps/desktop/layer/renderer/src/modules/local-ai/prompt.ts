import { getEntry } from "@follow/store/entry/getter"
import { getFeedById } from "@follow/store/feed/getter"

import type { AIChatContextBlock, BizUIMessage } from "~/modules/ai-chat/store/types"
import { getEntryContentAsMarkdown } from "~/modules/integration/entry-content-markdown"

import type { LocalAIMessage } from "./bridge"

/** Entry contents are long; a single message keeps the most recent part of them */
const MAX_ENTRY_CONTENT_CHARS = 12_000

const trimToLength = (value: string, max: number) => {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}\n\n(内容过长，已截断)`
}

const formatDate = (date: Date | null | undefined) => {
  if (!date) return ""
  try {
    return date.toLocaleString()
  } catch {
    return ""
  }
}

const describeEntryBlock = async (entryId: string) => {
  const entry = getEntry(entryId)
  if (!entry) return ""

  const feedTitle = getFeedById(entry.feedId)?.title
  const meta = [
    `标题: ${entry.title || "(无标题)"}`,
    feedTitle ? `来源: ${feedTitle}` : "",
    entry.url ? `链接: ${entry.url}` : "",
    entry.publishedAt ? `发布时间: ${formatDate(entry.publishedAt)}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  let content = ""
  try {
    content = await getEntryContentAsMarkdown(entry)
  } catch {
    content = entry.description || ""
  }

  return `${meta}\n\n${trimToLength(content || entry.description || "", MAX_ENTRY_CONTENT_CHARS)}`
}

const describeFeedBlock = (feedIdList: string) => {
  const titles = feedIdList
    .split(",")
    .map((feedId) => getFeedById(feedId.trim())?.title)
    .filter(Boolean)

  if (titles.length === 0) return ""
  return `用户当前正在阅读 ${titles.join("、")} 这个订阅源。`
}

/**
 * The context bar of the chat sends structured blocks instead of text, and the official backend
 * is what turns them into prompt material. Locally the same data is read from the local database.
 */
const describeContextBlock = async (block: AIChatContextBlock): Promise<string> => {
  if (block.disabled) return ""

  switch (block.type) {
    case "mainEntry": {
      return describeEntryBlock(block.value)
    }
    case "mainFeed": {
      return describeFeedBlock(block.value)
    }
    case "mainView": {
      return "用户当前正在浏览时间线。"
    }
    case "unreadOnly": {
      return "用户开启了只看未读。"
    }
    case "fileAttachment": {
      const { attachment } = block
      return `附件: ${attachment.name}${attachment.serverUrl ? ` (${attachment.serverUrl})` : ""}`
    }
    default: {
      return ""
    }
  }
}

const describeContextBlocks = async (blocks: AIChatContextBlock[]) => {
  const parts: string[] = []
  for (const block of blocks) {
    const part = await describeContextBlock(block)
    if (part.trim()) parts.push(part)
  }
  return parts.join("\n\n")
}

const extractMessageText = async (message: BizUIMessage) => {
  const texts: string[] = []
  const contextParts: AIChatContextBlock[] = []

  for (const part of message.parts ?? []) {
    switch (part.type) {
      case "text": {
        if (part.text?.trim()) texts.push(part.text)
        break
      }
      case "data-rich-text": {
        const text = part.data?.text
        if (text?.trim()) texts.push(text)
        break
      }
      case "data-block": {
        if (Array.isArray(part.data)) contextParts.push(...part.data)
        break
      }
      case "reasoning": {
        break
      }
      default: {
        break
      }
    }
  }

  const context = contextParts.length > 0 ? await describeContextBlocks(contextParts) : ""
  const text = texts.join("\n\n").trim()

  if (!text && !context) return ""
  if (!context) return text
  return [context, text].filter(Boolean).join("\n\n---\n\n")
}

export const buildLocalChatMessages = async (messages: BizUIMessage[]) => {
  const result: LocalAIMessage[] = []

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue

    const content = await extractMessageText(message)
    if (!content) continue

    result.push({ role: message.role, content })
  }

  return result
}

/**
 * Replaces the server side prompt composition with a compact one. The scene specific instructions
 * of the official backend are not reproduced, so local replies are plainer than the hosted ones.
 */
export const buildLocalSystemPrompt = ({ personalizePrompt }: { personalizePrompt?: string }) => {
  const lines = [
    "你是 Folo 阅读器内置的 AI 助手，帮助用户阅读、总结和讨论文章。",
    "回答使用与用户提问相同的语言，除非用户另有要求。",
    "不要编造上下文中不存在的链接、数据或引文。",
  ]

  if (personalizePrompt?.trim()) {
    lines.push("", "用户的个性化偏好：", personalizePrompt.trim())
  }

  return lines.join("\n")
}
