import type { ConfigResponse } from "@follow-app/client-sdk"
import { useQuery } from "@tanstack/react-query"

import { useLocalAIEnabled, useLocalAIModelId } from "~/atoms/local-ai"
import { followApi } from "~/lib/api-client"

/** A year, in the units the quota payloads use */
const QUOTA_WINDOW_SECONDS = 365 * 24 * 60 * 60
/** Large enough that nothing derived from it reads as exhausted */
const LOCAL_QUOTA = 1_000_000

/**
 * The account quota the official endpoints meter. A local provider answers on its own bill, so the
 * chat UI is told an unlimited one: without this the send button and the "free trial" banner keep
 * asking for credits the user is not going to spend.
 */
const createLocalConfiguration = (model: string | null): ConfigResponse => {
  const resetAt = new Date(Date.now() + QUOTA_WINDOW_SECONDS * 1000)
  const windowResetTime = resetAt.getTime()

  return {
    defaultModel: model ?? "",
    availableModels: model ? [model] : [],
    availableModelsMenu: [],
    rateLimit: {
      maxTokens: LOCAL_QUOTA,
      currentTokens: 0,
      remainingTokens: LOCAL_QUOTA,
      windowDuration: QUOTA_WINDOW_SECONDS,
      windowResetTime,
    },
    attachmentLimits: {
      maxFiles: LOCAL_QUOTA,
      remainingFiles: LOCAL_QUOTA,
      windowDuration: QUOTA_WINDOW_SECONDS,
      windowResetTime,
    },
    usage: {
      total: LOCAL_QUOTA,
      used: 0,
      remaining: LOCAL_QUOTA,
      resetAt,
    },
    freeQuota: {
      shouldCheckDailyLimit: false,
      remainingRequests: LOCAL_QUOTA,
      remainingMonthlyRequests: LOCAL_QUOTA,
      role: "local",
      dailyLimit: LOCAL_QUOTA,
      monthlyLimit: LOCAL_QUOTA,
    },
  }
}

export const useAIConfiguration = () => {
  const isLocal = useLocalAIEnabled()
  const localModelId = useLocalAIModelId()

  return useQuery({
    queryKey: ["aiConfiguration", isLocal ? "local" : "official", isLocal ? localModelId : null],
    queryFn: async () => {
      if (isLocal) {
        return createLocalConfiguration(localModelId)
      }

      return followApi.ai.config()
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}
