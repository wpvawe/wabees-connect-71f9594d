import { PENDING_INVITE_KEY } from "@/lib/firebase/agent-invites";

/**
 * Where should the user land after a successful sign-in / sign-up? Honors a
 * pending agent invite captured before auth (stored in sessionStorage by
 * `/join/{code}`), otherwise defaults to the dashboard.
 */
export function postAuthDestination():
  | { to: "/dashboard" }
  | { to: "/join/$code"; params: { code: string } } {
  try {
    const pending = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    if (pending) {
      return { to: "/join/$code", params: { code: pending } };
    }
  } catch {
    /* ignore storage failures */
  }
  return { to: "/dashboard" };
}
