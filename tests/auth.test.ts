import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import app from "../src/index.js";
import { hashToken } from "../src/services/sessions.js";

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
