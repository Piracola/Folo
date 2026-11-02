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

/**
 * The AI features a local provider can take over. Everything else keeps using the official
 * backend, so a half configured provider never breaks the parts the user did not opt into.
 */
export type LocalAIFeature = "chat" | "summary" | "title"

export const LOCAL_AI_FEATURES: LocalAIFeature[] = ["chat", "summary", "title"]

export type LocalAIFeatureFlags = Record<LocalAIFeature, boolean>

const defaultFeatureFlags: LocalAIFeatureFlags = {
  chat: true,
  summary: true,
  title: true,
}

export const normalizeLocalAIFeatureFlags = (
  flags: Partial<LocalAIFeatureFlags> | undefined | null,
): LocalAIFeatureFlags => ({ ...defaultFeatureFlags, ...flags })

export interface LocalAISettings {
  enabled: boolean
  provider: LocalAIProviderConfig
  /** Which of the features above the provider answers */
  features: LocalAIFeatureFlags
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
  features: defaultFeatureFlags,
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

/** Whether the switch is on, which is the user asking for local replies */
export const isLocalAIEnabled = () => !!getLocalAISettings()?.enabled

export const useLocalAIEnabled = () => !!useLocalAISettings()?.enabled

/** Whether this particular feature is served by the local provider */
export const isLocalAIEnabledFor = (feature: LocalAIFeature) => {
  const settings = getLocalAISettings()
  if (!settings?.enabled) return false

  return normalizeLocalAIFeatureFlags(settings.features)[feature]
}

export const useLocalAIEnabledFor = (feature: LocalAIFeature) => {
  const enabled = useLocalAIEnabled()
  const settings = useLocalAISettings()

  return enabled && normalizeLocalAIFeatureFlags(settings?.features)[feature]
}

/** The usable provider, or null while the address or the model is still missing */
export const useLocalAIProvider = () => normalizeLocalAIProvider(useLocalAISettings())

/** Model id exposed to the chat UI, shaped like the server model ids (`provider/model`) */
export const formatLocalAIModelId = (provider: LocalAIProviderConfig) =>
  `${provider.kind}/${provider.model}`

/**
 * The model id the chat header should show while the local switch is on, even when the settings are
 * still incomplete, so the header never falls back to an official model behind the user's back.
 */
export const useLocalAIModelId = () => {
  const settings = useLocalAISettings()
  if (!settings?.enabled) return null

  const provider = normalizeLocalAIProvider(settings)
  if (provider) return formatLocalAIModelId(provider)

  const raw = settings.provider
  return formatLocalAIModelId({ ...raw, model: raw.model?.trim() || "未配置" })
}
