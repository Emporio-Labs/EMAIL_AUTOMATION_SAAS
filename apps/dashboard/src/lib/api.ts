const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export async function apiFetch<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Request failed");
  }

  return response.json() as Promise<T>;
}

export async function loginWithPassword(email: string, password: string) {
  return apiFetch<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: { id: string; email?: string | null };
  }>("/v1/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchMe(token: string) {
  return apiFetch<{
    user: { id: string; email?: string | null };
    tenant: { id: string; name: string; slug: string | null; role: string };
  }>("/v1/auth/me", token);
}
