import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// AUTH_MODE is read once at startup, so this file loads the app with AUTH_MODE=basic
type App = typeof import("../src/index.js")["default"];
let app: App;
let outbox: typeof import("../src/lib/mailer.js")["outbox"];
let prisma: typeof import("../src/db.js")["prisma"];

beforeAll(async () => {
  vi.stubEnv("AUTH_MODE", "basic");
  vi.resetModules();
  app = (await import("../src/index.js")).default;
  outbox = (await import("../src/lib/mailer.js")).outbox;
  prisma = (await import("../src/db.js")).prisma;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const json = { "Content-Type": "application/json" };
const send = (method: string, path: string, body?: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: token ? { ...json, Authorization: `Bearer ${token}` } : json,
    body: body ? JSON.stringify(body) : undefined,
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

async function loginAs(email: string, password = "password123") {
  const res = await send("POST", "/api/auth/login", { email, password });
  expect(res.status).toBe(200);
  return (await res.json()) as { accessToken: string; user: { id: string } };
}

describe("AUTH_MODE=basic", () => {
  it("keeps users, login, sessions, tasks and audit", async () => {
    const email = `basic-${randomUUID()}@example.com`;
    const register = await send("POST", "/api/auth/register", {
      name: "Basic User",
      email,
      password: "password123",
    });
    expect(register.status).toBe(201);
    const { accessToken } = await loginAs(email);

    expect((await send("GET", "/api/tasks")).status).toBe(401);
    expect((await send("GET", "/api/tasks", undefined, accessToken)).status).toBe(200);
    expect((await send("GET", "/api/sessions/me", undefined, accessToken)).status).toBe(200);
    const admin = await loginAs("admin@example.com");
    expect((await send("GET", "/api/audit-logs", undefined, admin.accessToken)).status).toBe(200);
  });

  it("does not mount recovery, verification or MFA routes", async () => {
    const { accessToken } = await loginAs("admin@example.com");
    for (const [method, path] of [
      ["POST", "/api/auth/forgot-password"],
      ["POST", "/api/auth/reset-password"],
      ["POST", "/api/auth/verify-email"],
      ["POST", "/api/auth/resend-verification"],
      ["POST", "/api/auth/mfa/setup"],
      ["POST", "/api/auth/mfa/enable"],
      ["POST", "/api/auth/mfa/disable"],
      ["DELETE", "/api/users/user-2/mfa"],
    ] as const) {
      const res = await send(method, path, { email: "ana@example.com" }, accessToken);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("still asks for the second factor of accounts enrolled while AUTH_MODE was full", async () => {
    const email = `enrolled-${randomUUID()}@example.com`;
    await send("POST", "/api/auth/register", {
      name: "Enrolled User",
      email,
      password: "password123",
    });
    // Downgrading the mode must not silently drop an existing 2FA protection
    await prisma.user.update({ where: { email }, data: { totpEnabledAt: new Date() } });
    const res = await send("POST", "/api/auth/login", { email, password: "password123" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { details?: { code?: string } }).details?.code).toBe(
      "MFA_REQUIRED",
    );
  });

  it("sends no email on registration or email change", async () => {
    const before = outbox.length;
    const email = `quiet-${randomUUID()}@example.com`;
    await send("POST", "/api/auth/register", {
      name: "Quiet User",
      email,
      password: "password123",
    });
    const { accessToken, user } = await loginAs(email);
    const moved = `moved-${randomUUID()}@example.com`;
    const put = await send(
      "PUT",
      `/api/users/${user.id}`,
      { email: moved, currentPassword: "password123" },
      accessToken,
    );
    expect(put.status).toBe(200);
    await settle();
    expect(outbox.slice(before).filter((m) => m.to === email || m.to === moved)).toHaveLength(0);
  });

  it("publishes and lists only the mounted routes", async () => {
    const spec = (await (await app.request("/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    const paths = Object.keys(spec.paths);
    expect(paths).toContain("/api/auth/login");
    expect(paths).toContain("/api/users/{id}");
    for (const hidden of [
      "/api/auth/forgot-password",
      "/api/auth/reset-password",
      "/api/auth/verify-email",
      "/api/auth/resend-verification",
      "/api/auth/mfa/setup",
      "/api/users/{id}/mfa",
    ]) {
      expect(paths).not.toContain(hidden);
    }

    const body = (await (await app.request("/")).json()) as {
      authMode: string;
      endpoints: { auth: Record<string, string>; users: Record<string, string>; mfa?: unknown };
    };
    expect(body.authMode).toBe("basic");
    expect(Object.keys(body.endpoints.auth).sort()).toEqual(
      ["login", "logout", "refresh", "register"].sort(),
    );
    expect(body.endpoints.mfa).toBeUndefined();
    expect(body.endpoints.users.resetUserMfa).toBeUndefined();
  });
});
