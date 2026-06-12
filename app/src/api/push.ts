import type { PushPublicKeyResponse, PushSubscribeInput } from "@pawary/shared";
import { api } from "./client";

export function getPushPublicKey(): Promise<string> {
  return api<PushPublicKeyResponse>("/api/push/public-key").then(
    (res) => res.publicKey,
  );
}

export function subscribePush(
  input: PushSubscribeInput,
): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/api/push/subscriptions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function unsubscribePush(endpoint: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/api/push/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}
