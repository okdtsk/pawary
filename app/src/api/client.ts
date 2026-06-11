export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  if (method !== "GET") {
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    if (init.body) headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string } }
    | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? "Request failed",
    );
  }
  return body!.data as T;
}
