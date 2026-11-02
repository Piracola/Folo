import { useEffect, useMemo } from "react"

import { useLocalAIEnabledFor, useLocalAIModelId } from "~/atoms/local-ai"

import { setAIModelState, useAIModelState } from "../atoms/session"
import { useAIConfiguration } from "./useAIConfiguration"

export const useAIModel = () => {
  const { data: configuration, isLoading } = useAIConfiguration()
  const modelState = useAIModelState()
  // With a local provider the model is a setting of this device, not one of the account's models
  const localModelId = useLocalAIModelId()
  const isLocalChat = useLocalAIEnabledFor("chat")
  const activeLocalModelId = isLocalChat ? localModelId : null

  // Validate and sync persistent model with available models
  useEffect(() => {
    if (activeLocalModelId || !configuration || isLoading) return

    const { selectedModel } = modelState
    const { defaultModel, availableModels = [] } = configuration

    // If no model is selected or selected model is not available, use default
    if (!selectedModel || !availableModels.includes(selectedModel)) {
      setAIModelState({
        selectedModel: defaultModel || null,
      })
    }
  }, [configuration, isLoading, modelState, activeLocalModelId])

  // Get current effective model
  const currentModel = useMemo(() => {
    if (activeLocalModelId) {
      return activeLocalModelId
    }

    if (!configuration) return null

    const { selectedModel } = modelState
    const { defaultModel, availableModels = [] } = configuration

    // Return selected model if valid, otherwise fallback to default
    if (selectedModel && availableModels.includes(selectedModel)) {
      return selectedModel
    }

    return defaultModel || null
  }, [configuration, modelState, activeLocalModelId])

  const changeModel = (model: string) => {
    if (activeLocalModelId) {
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

  if (activeLocalModelId) {
    return {
      data: {
        defaultModel: activeLocalModelId,
        availableModels: [activeLocalModelId],
        availableModelsMenu: [],
        currentModel: activeLocalModelId,
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
