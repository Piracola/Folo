import { useEffect, useMemo } from "react"

import { formatLocalAIModelId, useLocalAIProvider } from "~/atoms/local-ai"

import { setAIModelState, useAIModelState } from "../atoms/session"
import { useAIConfiguration } from "./useAIConfiguration"

export const useAIModel = () => {
  const { data: configuration, isLoading } = useAIConfiguration()
  const modelState = useAIModelState()
  // With a local provider the model is a setting of this device, not one of the account's models
  const localProvider = useLocalAIProvider()

  // Validate and sync persistent model with available models
  useEffect(() => {
    if (localProvider || !configuration || isLoading) return

    const { selectedModel } = modelState
    const { defaultModel, availableModels = [] } = configuration

    // If no model is selected or selected model is not available, use default
    if (!selectedModel || !availableModels.includes(selectedModel)) {
      setAIModelState({
        selectedModel: defaultModel || null,
      })
    }
  }, [configuration, isLoading, modelState, localProvider])

  // Get current effective model
  const currentModel = useMemo(() => {
    if (localProvider) {
      return formatLocalAIModelId(localProvider)
    }

    if (!configuration) return null

    const { selectedModel } = modelState
    const { defaultModel, availableModels = [] } = configuration

    // Return selected model if valid, otherwise fallback to default
    if (selectedModel && availableModels.includes(selectedModel)) {
      return selectedModel
    }

    return defaultModel || null
  }, [configuration, modelState, localProvider])

  const changeModel = (model: string) => {
    if (localProvider) {
      return
    }

    if (!configuration?.availableModels?.includes(model)) {
      console.warn(`Model ${model} is not available in current configuration`)
      return
    }

    setAIModelState({
      selectedModel: model,
    })
  }

  if (localProvider) {
    const localModel = formatLocalAIModelId(localProvider)
    return {
      data: {
        defaultModel: localModel,
        availableModels: [localModel],
        availableModelsMenu: [],
        currentModel: localModel,
      },
      isLoading: false,
      changeModel,
    }
  }

  return {
    data: {
      defaultModel: configuration?.defaultModel,
      availableModels: configuration?.availableModels,
      availableModelsMenu: configuration?.availableModelsMenu,
      currentModel,
    },
    isLoading,
    changeModel,
  }
}
