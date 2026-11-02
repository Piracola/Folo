import { getDebugFeatureValue, useDebugFeatureValue } from "~/atoms/debug-feature"
import type { featureConfigMap } from "~/lib/features"

// Define debug feature value structure
interface DebugFeatureValue {
  __override?: boolean
  [key: string]: boolean | undefined
}

// Define feature key type
export type FeatureKey = keyof typeof featureConfigMap

/**
 * Core feature checking logic to avoid code duplication
 * @param feature - Feature key name
 * @param debugFeatureValue - Debug feature values
 * @returns Whether the feature is enabled
 */
const checkFeatureEnabled = (
  feature: FeatureKey,
  debugFeatureValue: DebugFeatureValue,
): boolean => {
  const override = !!debugFeatureValue.__override

  if (override) {
    return !!debugFeatureValue[feature]
  }

  // Feature switches of this build are always on. Nothing else is faked: the plan screen, the
  // upgrade prompts and every request the official backend still has to answer behave as before.
  return true
}

/**
 * React Hook: Check if a specific feature is enabled
 * @param feature - Feature key name
 * @returns Whether the feature is enabled
 */
export const useFeature = (feature: FeatureKey): boolean => {
  const debugFeatureValue = useDebugFeatureValue() as DebugFeatureValue

  return checkFeatureEnabled(feature, debugFeatureValue)
}

/**
 * Non-Hook function: Check if a specific feature is enabled
 * @param feature - Feature key name
 * @returns Whether the feature is enabled
 */
export const getFeature = (feature: FeatureKey): boolean => {
  const debugFeatureValue = getDebugFeatureValue() as DebugFeatureValue

  return checkFeatureEnabled(feature, debugFeatureValue)
}
