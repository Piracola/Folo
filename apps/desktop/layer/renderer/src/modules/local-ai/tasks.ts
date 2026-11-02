import type { SupportedActionLanguage } from "@follow/shared"
import { getEntry } from "@follow/store/entry/getter"
import { usePrefetchSummary } from "@follow/store/summary/hooks"
import { summaryActions, useSummaryStore } from "@follow/store/summary/store"
import { useQuery } from "@tanstack/react-query"

import { getLocalAIProvider, useLocalAIEnabled } from "~/atoms/local-ai"
import { convertHtmlToIntegrationMarkdown } from "~/modules/integration/entry-content-markdown"

import type { LocalAIMessage } from "./bridge"
import { completeLocalChat } from "./bridge"

type SummaryTarget = "content" | "readabilityContent"

type SummaryRow = {
  entryId: string
  summary: string
  readabilitySummary: string | null
  language: SupportedActionLanguage | null
}

/** Entry bodies are long; a summary only needs the beginning to stay on topic */
const MAX_SUMMARY_SOURCE_CHARS = 12_000

const LANGUAGE_NAMES: Record<SupportedActionLanguage, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  "fr-FR": "Français",
}

const trimToLength = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max)}\n\n(后文已省略)`

const readCachedSummary = (
  entryId: string,
  actionLanguage: SupportedActionLanguage,
  target: SummaryTarget,
) => {
  const cached = useSummaryStore.getState().data[entryId]?.[actionLanguage]
  if (!cached) return null
  return (target === "content" ? cached.summary : cached.readabilitySummary) || null
}

/**
 * Writes the summary where the official flow writes it, so the card, the database cache and the
 * export all see the same data whichever provider produced it.
 */
const persistSummary = async ({
  entryId,
  actionLanguage,
  target,
  text,
}: {
  entryId: string
  actionLanguage: SupportedActionLanguage
  target: SummaryTarget
  text: string
}) => {
  const row: SummaryRow = {
    entryId,
    summary: target === "content" ? text : "",
    language: actionLanguage,
    readabilitySummary: target === "readabilityContent" ? text : null,
  }
  await summaryActions.upsertMany([row])
}

export const generateLocalSummary = async ({
  entryId,
  target,
  actionLanguage,
}: {
  entryId: string
  target: SummaryTarget
  actionLanguage: SupportedActionLanguage
}): Promise<string | null> => {
  const provider = getLocalAIProvider()
  if (!provider) {
    throw new Error("本机 AI 服务商还没配置完整，请到设置 · AI 里补全接口地址和模型。")
  }

  const cached = readCachedSummary(entryId, actionLanguage, target)
  if (cached) return cached

  const entry = getEntry(entryId)
  if (!entry) return null

  const html =
    (target === "readabilityContent" ? entry.readabilityContent || entry.content : entry.content) ||
    entry.description ||
    ""

  const content = trimToLength(
    await convertHtmlToIntegrationMarkdown(html),
    MAX_SUMMARY_SOURCE_CHARS,
  )
  if (!content.trim()) return null

  const language = LANGUAGE_NAMES[actionLanguage] ?? actionLanguage
  const messages: LocalAIMessage[] = [
    {
      role: "system",
      content: [
        `你是一个文章摘要助手。请用${language}输出摘要。`,
        "只依据提供的正文，不要编造正文中没有的信息。",
        "使用 Markdown，先给一到两句总览，再用要点列出关键信息，总长度不超过 400 字。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `标题：${entry.title || "(无标题)"}\n\n正文：\n\n${content}`,
    },
  ]

  const text = (await completeLocalChat(provider, messages)).trim()
  if (!text) return null

  await persistSummary({ entryId, actionLanguage, target, text })
  return text
}

/**
 * Drop-in replacement for `usePrefetchSummary`: the official query stays mounted but disabled while
 * the local switch is on, keeping the hook order stable.
 */
export const useAISummary = ({
  entryId,
  target,
  actionLanguage,
  enabled,
}: {
  entryId: string
  target: SummaryTarget
  actionLanguage: SupportedActionLanguage
  enabled?: boolean
}) => {
  const isLocal = useLocalAIEnabled()

  const official = usePrefetchSummary({
    entryId,
    target,
    actionLanguage,
    enabled: !!enabled && !isLocal,
  })

  const local = useQuery({
    queryKey: ["local-summary", entryId, target, actionLanguage],
    queryFn: () => generateLocalSummary({ entryId, target, actionLanguage }),
    enabled: !!enabled && isLocal,
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
  })

  return isLocal ? local : official
}

const MAX_TITLE_SOURCE_CHARS = 2_000

export const generateLocalChatTitle = async (
  messages: { role: string; content: string }[],
): Promise<string | null> => {
  const provider = getLocalAIProvider()
  if (!provider) {
    throw new Error("本机 AI 服务商还没配置完整，请到设置 · AI 里补全接口地址和模型。")
  }

  const transcript = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(0, MAX_TITLE_SOURCE_CHARS)

  if (!transcript.trim()) return null

  const text = await completeLocalChat(provider, [
    {
      role: "system",
      content: "为下面的对话起一个标题。只输出标题本身，不要引号、不要句末标点，不超过 20 个字。",
    },
    { role: "user", content: transcript },
  ])

  const title = text
    .trim()
    .replace(/^["'“”「」]|["'“”「」]$/g, "")
    .slice(0, 60)
  return title || null
}
