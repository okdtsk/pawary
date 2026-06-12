/**
 * Carries a /join/<token> across the Google OAuth round-trip: the logged-out
 * app saves it before showing Login (the OAuth callback always lands on "/"),
 * and the router replays it once a session exists. localStorage failures
 * (private mode) degrade to "invitee re-opens the link after logging in".
 */
const KEY = "pawary:pendingInviteToken";

export function savePendingInvite(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // ignore — see above
  }
}

export function takePendingInvite(): string | null {
  try {
    const token = localStorage.getItem(KEY);
    if (token !== null) localStorage.removeItem(KEY);
    return token;
  } catch {
    return null;
  }
}

export function pendingInviteFromPath(pathname: string): string | null {
  const match = /^\/join\/([^/]+)$/.exec(pathname);
  return match ? match[1]! : null;
}
