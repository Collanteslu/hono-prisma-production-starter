import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import app from "../src/index.js";
import { hashToken } from "../src/services/sessions.js";
import { createTestUser, jsonHeaders } from "./helpers.js";

describe("Authentication & Session API", () => {
  let accessToken = "";
  let refreshToken = "";

  it("POST /api/auth/login with valid credentials should return tokens and session", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    expect(data.sessionId).toBeDefined();
    expect(data.user.email).toBe("admin@example.com");

    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
  });

  it("POST /api/auth/login with invalid password should fail with 401", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@example.com",
        password: "wrongpassword",
      }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it("GET /api/sessions/me should list active sessions for authenticated user", async () => {
    const res = await app.request("/api/sessions/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);

    // Ownership: the route is scoped to the caller, so no other account's session may appear
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    for (const session of data.data) {
      expect(session.userId).toBe(admin.id);
    }
    expect(data.data.filter((s: { isCurrent: boolean }) => s.isCurrent)).toHaveLength(1);
    expect(data.currentSessionId).toBe(
      data.data.find((s: { isCurrent: boolean }) => s.isCurrent).id,
    );
  });

  it("POST /api/auth/refresh should perform token rotation", async () => {
    const res = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: refreshToken,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    expect(data.refreshToken).not.toBe(refreshToken); // rotated
  });

  it("a rotated refresh token never outlives the session's absolute expiry", async () => {
    const user = await createTestUser();
    // Pretend the session was opened 2 days ago, so a fresh full TTL would clearly overshoot it
    const session = await prisma.session.update({
      where: { id: user.sessionId },
      data: { expiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 5 * 24 * 3600 * 1000) },
    });

    const res = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: user.refreshToken }),
    });
    expect(res.status).toBe(200);
    const { refreshToken } = await res.json();

    const stored = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(refreshToken) },
    });
    expect(stored.expiresAt.getTime()).toBe(session.expiresAt.getTime());
    const [, payload] = refreshToken.split(".");
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(exp).toBe(Math.floor(session.expiresAt.getTime() / 1000));
  });

  it("POST /api/auth/refresh reusing an already rotated token should terminate session", async () => {
    // Simulate that the rotation happened long ago (outside the concurrent-refresh grace period)
    await prisma.refreshToken.update({
      where: { tokenHash: hashToken(refreshToken) },
      data: { usedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    // Re-submit the old (already rotated) refresh token
    const res = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: refreshToken,
      }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Security alert");
  });

  it("Standard user cannot list all users (GET /api/users should return 403)", async () => {
    // 1. Login as standard user (Ana)
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ana@example.com",
        password: "password123",
      }),
    });
    const { accessToken: userToken } = await loginRes.json();

    // 2. Attempt to list users
    const listRes = await app.request("/api/users", {
      method: "GET",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(listRes.status).toBe(403);

    // 3. Attempt to inspect admin account (with or without includes)
    const getOtherRes = await app.request("/api/users/user-1?include=sessions,tasks", {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(getOtherRes.status).toBe(403);

    // 4. Attempt to modify admin account
    const putRes = await app.request("/api/users/user-1", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Hacked Admin" }),
    });
    expect(putRes.status).toBe(403);
  });
});
