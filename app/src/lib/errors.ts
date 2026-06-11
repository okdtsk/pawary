import { ApiError } from "../api/client";
import type { Messages } from "../i18n/messages";

/**
 * Toast copy for a failed mutation: the offline guard's localized message
 * when that is the cause, the generic error title otherwise.
 */
export function friendlyError(error: unknown, t: Messages): string {
  if (error instanceof ApiError && error.code === "offline") return error.message;
  return t.errors.title;
}
