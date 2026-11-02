import { UserRole } from "@follow/constants"
import { useUserStore } from "@follow/store/user/store"

/**
 * Most member-only parts of the app only ask the user store which role the account has, so a
 * signed in account is reported here as a paid one.
 *
 * Only this device is affected: whatever the server decides on its own, such as the AI quota it
 * meters per account, still answers for the real plan.
 */
const GRANTED_ROLE = UserRole.Pro

const grantRole = () => {
  const { whoami, role } = useUserStore.getState()
  if (!whoami || role === GRANTED_ROLE) {
    return
  }

  useUserStore.setState({ role: GRANTED_ROLE })
}

grantRole()
useUserStore.subscribe(grantRole)
