import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@follow/components/ui/select/index.js"
import { Switch } from "@follow/components/ui/switch/index.jsx"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { LocalAIFeature, LocalAIProviderConfig, LocalAIProviderKind } from "~/atoms/local-ai"
import {
  defaultLocalAISettings,
  getLocalAIProviderPreset,
  getLocalAISettings,
  LOCAL_AI_FEATURES,
  LOCAL_AI_PROVIDER_PRESETS,
  normalizeLocalAIFeatureFlags,
  normalizeLocalAIProvider,
  setLocalAISettings,
  useLocalAISettings,
} from "~/atoms/local-ai"
import { completeLocalChat } from "~/modules/local-ai/bridge"

const FEATURE_TEXT = {
  chat: {
    label: "local_provider.feature_chat",
    description: "local_provider.feature_chat_desc",
  },
  summary: {
    label: "local_provider.feature_summary",
    description: "local_provider.feature_summary_desc",
  },
  title: {
    label: "local_provider.feature_title",
    description: "local_provider.feature_title_desc",
  },
} as const satisfies Record<LocalAIFeature, { label: string; description: string }>

/**
 * Settings for an AI provider that the app talks to directly.
 *
 * Unlike the account level BYOK section, keys entered here stay on this device and are only used
 * by the Electron main process, so the AI features keep working without the Folo backend.
 */
export const LocalProviderSection = () => {
  const { t } = useTranslation("ai")
  const settings = useLocalAISettings()
  const enabledSwitchId = useId()
  const [isTesting, setIsTesting] = useState(false)

  const provider: LocalAIProviderConfig = settings?.provider ?? defaultLocalAISettings.provider
  const enabled = !!settings?.enabled
  const features = normalizeLocalAIFeatureFlags(settings?.features)
  const preset = getLocalAIProviderPreset(provider.kind)
  const isReady = !!normalizeLocalAIProvider({ enabled: true, features, provider })

  const updateProvider = (patch: Partial<LocalAIProviderConfig>) => {
    const current = getLocalAISettings() ?? defaultLocalAISettings
    setLocalAISettings({
      ...current,
      provider: { ...current.provider, ...patch },
    })
  }

  const handleToggleEnabled = (nextEnabled: boolean) => {
    const current = getLocalAISettings() ?? defaultLocalAISettings
    setLocalAISettings({ ...current, enabled: nextEnabled })
  }

  const handleKindChange = (kind: LocalAIProviderKind) => {
    const nextPreset = getLocalAIProviderPreset(kind)
    updateProvider({ kind, baseURL: nextPreset.baseURL, model: nextPreset.model })
  }

  const handleToggleFeature = (feature: LocalAIFeature, nextEnabled: boolean) => {
    const current = getLocalAISettings() ?? defaultLocalAISettings
    setLocalAISettings({
      ...current,
      features: { ...normalizeLocalAIFeatureFlags(current.features), [feature]: nextEnabled },
    })
  }

  const handleTest = async () => {
    const normalized = normalizeLocalAIProvider({ enabled: true, features, provider })
    if (!normalized) {
      toast.error(t("local_provider.test_incomplete"))
      return
    }

    setIsTesting(true)
    try {
      const text = await completeLocalChat(normalized, [{ role: "user", content: "ping" }])
      toast.success(t("local_provider.test_success"), {
        description: text.trim().slice(0, 80) || undefined,
      })
    } catch (error) {
      toast.error(t("local_provider.test_failed"), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor={enabledSwitchId} className="text-sm font-medium text-text">
            {t("local_provider.enabled")}
          </Label>
          <div className="text-xs text-text-secondary">{t("local_provider.description")}</div>
        </div>
        <Switch id={enabledSwitchId} checked={enabled} onCheckedChange={handleToggleEnabled} />
      </div>

      {enabled && (
        <>
          <div className="space-y-2">
            <Label>{t("local_provider.provider")}</Label>
            <Select value={provider.kind} onValueChange={handleKindChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCAL_AI_PROVIDER_PRESETS.map((option) => (
                  <SelectItem key={option.kind} value={option.kind}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("local_provider.base_url")}</Label>
            <Input
              type="url"
              placeholder={preset.baseURL || "https://api.example.com/v1"}
              value={provider.baseURL}
              onChange={(event) => updateProvider({ baseURL: event.target.value })}
            />
            <p className="text-xs text-text-secondary">{t("local_provider.base_url_help")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("local_provider.api_key")}</Label>
            <Input
              type="password"
              placeholder={preset.requiresApiKey ? "sk-..." : t("local_provider.api_key_optional")}
              value={provider.apiKey}
              onChange={(event) => updateProvider({ apiKey: event.target.value })}
            />
            <p className="text-xs text-text-secondary">{t("local_provider.api_key_help")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("local_provider.model")}</Label>
            <Input
              placeholder={preset.model || "gpt-4o-mini"}
              value={provider.model}
              onChange={(event) => updateProvider({ model: event.target.value })}
            />
            <p className="text-xs text-text-secondary">{t("local_provider.model_help")}</p>
          </div>

          <div className="space-y-2">
            <Label>{t("local_provider.features")}</Label>
            <p className="text-xs text-text-secondary">{t("local_provider.features_help")}</p>
            <div className="divide-y divide-fill-secondary rounded-md border border-fill-secondary">
              {LOCAL_AI_FEATURES.map((feature) => {
                const switchId = `${enabledSwitchId}-${feature}`
                const text = FEATURE_TEXT[feature]

                return (
                  <div key={feature} className="flex items-center justify-between gap-3 p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor={switchId} className="text-sm text-text">
                        {t(text.label)}
                      </Label>
                      <div className="text-xs text-text-secondary">{t(text.description)}</div>
                    </div>
                    <Switch
                      id={switchId}
                      checked={features[feature]}
                      onCheckedChange={(next) => handleToggleFeature(feature, next)}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" disabled={isTesting} onClick={handleTest}>
              {isTesting ? (
                <i className="i-mgc-loading-3-cute-re mr-2 size-4 animate-spin" />
              ) : (
                <i className="i-mgc-play-cute-re mr-2 size-4" />
              )}
              {t("local_provider.test")}
            </Button>
            {!isReady && <span className="text-xs text-red">{t("local_provider.incomplete")}</span>}
          </div>
        </>
      )}
    </div>
  )
}
