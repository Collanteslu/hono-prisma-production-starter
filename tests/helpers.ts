import { randomUUID } from "node:crypto";
import app from "../src/index.js";

export { app };

export const jsonHeaders = { "Content-Type": "application/json" };

export function bearer(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...jsonHeaders, ...extra };
}

export async function login(email: string, password = "password123") {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    user: { id: string; email: string; role: string };
  };
}

export const loginAdmin = () => login("admin@example.com");

/** Registers a fresh standard user (unique email) and returns its credentials and first session */
export async function createTestUser(password = "password123") {
  const email = `user-${randomUUID()}@example.com`;
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name: "Test User", email, password }),
  });
  if (res.status !== 201) throw new Error(`Register failed: ${res.status} ${await res.text()}`);
  const session = await login(email, password);
  return { email, password, ...session };
}
