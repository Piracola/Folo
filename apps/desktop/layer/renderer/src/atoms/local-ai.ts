import { getStorageNS } from "@follow/utils/ns"
import { atomWithStorage } from "jotai/utils"

import { createAtomHooks } from "~/lib/jotai"

/**
 * Local (bring-your-own) AI provider settings.
 *
 * Kept in its own storage entry instead of `AISettings` on purpose: this configuration never
 * leaves the device, is not part of the account sync, and other modules (feature flags) need to
 * read it without importing the settings chain, which would create an import cycle.
 */
export type LocalAIProviderKind =
  "openai" | "deepseek" | "moonshot" | "openrouter" | "ollama" | "custom"

export interface LocalAIProviderConfig {
  kind: LocalAIProviderKind
  /** OpenAI compatible base URL, without the trailing `/chat/completions` */
  baseURL: string
  apiKey: string
  model: string
  /** Extra headers sent with every request, e.g. OpenRouter attribution headers */
  headers?: Record<string, string>
}

export interface LocalAISettings {
  enabled: boolean
  provider: LocalAIProviderConfig
}

export interface LocalAIProviderPreset {
  kind: LocalAIProviderKind
  label: string
  baseURL: string
  model: string
  /** Presets without a key are served by a local runtime such as Ollama */
  requiresApiKey: boolean
}

export const LOCAL_AI_PROVIDER_PRESETS: LocalAIProviderPreset[] = [
  {
    kind: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    requiresApiKey: true,
  },
  {
    kind: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    requiresApiKey: true,
  },
  {
    kind: "moonshot",
    label: "Moonshot",
    baseURL: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    requiresApiKey: true,
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    requiresApiKey: true,
  },
  {
    kind: "ollama",
    label: "Ollama (local)",
    baseURL: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:7b",
    requiresApiKey: false,
  },
  {
    kind: "custom",
    label: "自定义 (OpenAI 兼容)",
    baseURL: "",
    model: "",
    requiresApiKey: true,
  },
]

export const getLocalAIProviderPreset = (kind: LocalAIProviderKind) =>
  LOCAL_AI_PROVIDER_PRESETS.find((preset) => preset.kind === kind) ?? LOCAL_AI_PROVIDER_PRESETS[0]!

const defaultProvider: LocalAIProviderConfig = {
  kind: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
}

export const defaultLocalAISettings: LocalAISettings = {
  enabled: false,
  provider: defaultProvider,
}

export const [, , useLocalAISettings, , getLocalAISettings, setLocalAISettings] = createAtomHooks(
  atomWithStorage<LocalAISettings>(getStorageNS("local-ai"), defaultLocalAISettings, undefined, {
    getOnInit: true,
  }),
)

/** The configured provider, or null when the local mode cannot be used yet */
export const normalizeLocalAIProvider = (
  settings: LocalAISettings | null | undefined,
): LocalAIProviderConfig | null => {
  const provider = settings?.provider
  if (!settings?.enabled || !provider) return null

  const preset = getLocalAIProviderPreset(provider.kind)
  const baseURL = (provider.baseURL || preset.baseURL || "").trim().replace(/\/+$/, "")
  const model = (provider.model || preset.model || "").trim()
  if (!baseURL || !model) return null

  return {
    ...provider,
    baseURL,
    model,
    apiKey: provider.apiKey?.trim() ?? "",
  }
}

export const getLocalAIProvider = () => normalizeLocalAIProvider(getLocalAISettings())

export const isLocalAIEnabled = () => !!getLocalAIProvider()

export const useLocalAIProvider = () => normalizeLocalAIProvider(useLocalAISettings())

/** Model id exposed to the chat UI, shaped like the server model ids (`provider/model`) */
export const formatLocalAIModelId = (provider: LocalAIProviderConfig) =>
  `${provider.kind}/${provider.model}`
