import { getPushPublicKey, subscribePush, unsubscribePush } from "../api/push";

/**
 * Converts a URL-safe base64 string (as used in VAPID keys) to a Uint8Array
 * suitable for `applicationServerKey`.
 */
export function urlBase64ToUint8Array(b64u: string): Uint8Array<ArrayBuffer> {
  // Restore standard base64 padding.
  const padded = b64u.padEnd(b64u.length + ((4 - (b64u.length % 4)) % 4), "=");
  // Replace URL-safe chars with standard base64 chars.
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

/** Returns true if the browser supports Web Push. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Returns the current push subscription, or null if the user is not
 * subscribed (or if there is no active service worker registration yet).
 *
 * Design decision: uses `navigator.serviceWorker.getRegistration()` rather
 * than `navigator.serviceWorker.ready` to avoid hanging indefinitely when no
 * SW is registered. `ready` would block forever if the SW registration is
 * somehow absent; `getRegistration()` resolves immediately with `undefined`
 * in that case.
 */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export type EnablePushResult =
  | { ok: true; subscription: PushSubscription }
  | { ok: false; reason: "denied" | "unsupported" | "error"; error?: unknown };

/**
 * Requests notification permission, subscribes to push, and POSTs the
 * subscription to the server.
 *
 * @param tz - Device timezone offset in minutes (e.g. `new Date().getTimezoneOffset() * -1`)
 */
export async function enablePush(tz: number): Promise<EnablePushResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, reason: "denied" };
    }

    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) {
      return { ok: false, reason: "error", error: new Error("No service worker registration found") };
    }

    const publicKey = await getPushPublicKey();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = sub.toJSON();
    const keys = json.keys as { p256dh: string; auth: string } | undefined;
    if (!keys?.p256dh || !keys?.auth) {
      await sub.unsubscribe();
      return { ok: false, reason: "error", error: new Error("Subscription keys missing") };
    }

    await subscribePush({
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      tz,
    });

    return { ok: true, subscription: sub };
  } catch (error) {
    return { ok: false, reason: "error", error };
  }
}

export type DisablePushResult =
  | { ok: true }
  | { ok: false; reason: "error"; error?: unknown };

/**
 * Unsubscribes from push and deletes the subscription from the server.
 */
export async function disablePush(): Promise<DisablePushResult> {
  try {
    const sub = await getCurrentSubscription();
    if (!sub) return { ok: true };

    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await unsubscribePush(endpoint);

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "error", error };
  }
}
