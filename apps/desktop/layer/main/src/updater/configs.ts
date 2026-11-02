import { MICROSOFT_STORE_BUILD } from "@follow/shared/constants"

const isStoreDistribution = Boolean(process.mas || MICROSOFT_STORE_BUILD)

export const appUpdaterConfig = {
  // This fork is distributed outside the official release channel, and the update feed only serves
  // official builds: keeping it on would replace these builds with the stock app on the next quit.
  enableRenderHotUpdate: false,
  enableCoreUpdate: false,

  // Disable app update will also disable renderer hot update and core update
  enableAppUpdate: false,
  enableDistributionStoreUpdate: isStoreDistribution,

  app: {
    autoCheckUpdate: false,
    autoDownloadUpdate: false,
    checkUpdateInterval: 15 * 60 * 1000,
  },
}
