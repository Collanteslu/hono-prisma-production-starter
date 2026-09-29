import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { app, bearer, createTestUser, jsonHeaders, login, loginAdmin } from "./helpers.js";

describe("Error handling", () => {
  it("malformed JSON returns 400 instead of 500", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: "{bad json",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it("unknown routes return the standard 404 envelope", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.meta.requestId).toBeDefined();
  });

  it("invalid typed filters return 400 instead of 500", async () => {
    const { accessToken } = await createTestUser();
    for (const query of [
      "filter[completed][gte]=abc",
      "filter[completed]=yes",
      "filter[createdAt][gte]=nope",
    ]) {
      const res = await app.request(`/api/tasks?${query}`, { headers: bearer(accessToken) });
      expect(res.status, query).toBe(400);
    }
  });

  it("multi-field sorting works (Prisma orderBy array)", async () => {
    const { accessToken } = await createTestUser();
    const res = await app.request("/api/tasks?sort=-completed,title", {
      headers: bearer(accessToken),
    });
    expect(res.status).toBe(200);
  });

  it("rejects malformed upstream X-Request-Id headers", async () => {
    const res = await app.request("/healthz", {
      headers: { "X-Request-Id": `forged <script> ${"x".repeat(200)}` },
    });
    expect(res.headers.get("X-Request-Id")).not.toContain("forged");
    const ok = await app.request("/healthz", { headers: { "X-Request-Id": "trace-123" } });
    expect(ok.headers.get("X-Request-Id")).toBe("trace-123");
  });
});

describe("Registration and user creation", () => {
  it("anonymous users can register, always with the user role", async () => {
    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        name: "Mallory",
        email: `  Mallory-${Date.now()}@Example.com `,
        password: "password123",
        role: "admin",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.role).toBe("user");
    expect(data.data.email).toMatch(/^mallory-\d+@example\.com$/);
    expect(data.data.password).toBeUndefined();
  });

  it("enforces the password policy (min 8 chars)", async () => {
    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        name: "Short",
        email: `short-${Date.now()}@example.com`,
        password: "123456",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("non-admin users cannot create accounts through POST /api/users", async () => {
    const { accessToken } = await createTestUser();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({
        name: "Eve",
        email: `eve-${Date.now()}@example.com`,
        password: "password123",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("admins can create users with any role", async () => {
    const { accessToken } = await loginAdmin();
    const res = await app.request("/api/users", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({
        name: "Second Admin",
        email: `admin2-${Date.now()}@example.com`,
        password: "password123",
        role: "admin",
      }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.role).toBe("admin");
  });
});

describe("Client IP handling", () => {
  it("ignores X-Forwarded-For when TRUST_PROXY is disabled", async () => {
    const { email, password } = await createTestUser();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { ...jsonHeaders, "X-Forwarded-For": "6.6.6.6" },
      body: JSON.stringify({ email, password }),
    });
    const { sessionId } = await res.json();
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.ipAddress).not.toBe("6.6.6.6");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "LOGIN", entityId: sessionId },
    });
    expect(audit?.ipAddress).not.toBe("6.6.6.6");
  });
});

describe("Refresh token rotation", () => {
  it("stores refresh tokens hashed, never in plaintext", async () => {
    const { refreshToken, sessionId } = await createTestUser();
    const stored = await prisma.refreshToken.findFirstOrThrow({ where: { sessionId } });
    expect(stored.tokenHash).not.toBe(refreshToken);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("concurrent refreshes with the same token do not kill the session", async () => {
    const { refreshToken } = await createTestUser();
    const send = () =>
      app.request("/api/auth/refresh", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ refreshToken }),
      });

    const responses = await Promise.all([send(), send()]);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);

    // The winning token pair must still be valid
    const winnerResponse = responses.find((r) => r.status === 200);
    if (!winnerResponse) throw new Error("No refresh request succeeded");
    const winner = await winnerResponse.json();
    const me = await app.request("/api/sessions/me", { headers: bearer(winner.accessToken) });
    expect(me.status).toBe(200);
    const next = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: winner.refreshToken }),
    });
    expect(next.status).toBe(200);
  });

  it("logout with a refresh token revokes its session", async () => {
    const { accessToken, refreshToken } = await createTestUser();
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.status).toBe(200);
    const me = await app.request("/api/sessions/me", { headers: bearer(accessToken) });
    expect(me.status).toBe(401);
  });
});

describe("Authorization is evaluated against the database", () => {
  it("uses the current role from the database, not the JWT claim", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.user.id }, data: { role: "admin" } });
    const res = await app.request("/api/users", { headers: bearer(user.accessToken) });
    expect(res.status).toBe(200);

    await prisma.user.update({ where: { id: user.user.id }, data: { role: "user" } });
    const denied = await app.request("/api/users", { headers: bearer(user.accessToken) });
    expect(denied.status).toBe(403);
  });

  it("does not leak internal verification errors on invalid tokens", async () => {
    const res = await app.request("/api/tasks", { headers: bearer("not-a-jwt") });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeUndefined();
  });

  it("locks an account after repeated failed logins", async () => {
    const { email } = await createTestUser();
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ email, password: "wrong-password" }),
      });
      expect(res.status).toBe(401);
    }
    const locked = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password: "password123" }),
    });
    expect(locked.status).toBe(429);
  });

  it("records failed logins in the audit log", async () => {
    const email = `ghost-${Date.now()}@example.com`;
    await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password: "whatever1" }),
    });
    const entry = await prisma.auditLog.findFirst({
      where: { action: "LOGIN_FAILED", details: { contains: email } },
    });
    expect(entry).not.toBeNull();
  });

  it("login still works for the seeded admin", async () => {
    const session = await login("admin@example.com");
    expect(session.user.role).toBe("admin");
  });
});
