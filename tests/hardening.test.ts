import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { cleanupExpiredSessions } from "../src/jobs/cleanup.js";
import { hitBucket, peekBucket } from "../src/lib/rateLimitStore.js";
import { rateLimiter } from "../src/middleware/rateLimit.js";
import { app, bearer, createTestUser, loginAdmin } from "./helpers.js";

async function createTask(token: string) {
  const res = await app.request("/api/tasks", {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify({ title: "Private task" }),
  });
  return (await res.json()).data as { id: string };
}

describe("Resources of other users are indistinguishable from missing ones", () => {
  it("answers 404 (never 403) for foreign tasks on every verb", async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const task = await createTask(owner.accessToken);

    for (const [method, path, body] of [
      ["GET", `/api/tasks/${task.id}`],
      ["PUT", `/api/tasks/${task.id}`, { title: "Hijacked" }],
      ["DELETE", `/api/tasks/${task.id}`],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: bearer(intruder.accessToken),
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const missing = await app.request(`/api/tasks/${randomUUID()}`, {
      headers: bearer(intruder.accessToken),
    });
    expect(missing.status).toBe(404);
  });

  it("answers 404 when revoking someone else's session, but admins still can", async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();

    const denied = await app.request(`/api/sessions/${owner.sessionId}`, {
      method: "DELETE",
      headers: bearer(intruder.accessToken),
    });
    expect(denied.status).toBe(404);

    const admin = await loginAdmin();
    const allowed = await app.request(`/api/sessions/${owner.sessionId}`, {
      method: "DELETE",
      headers: bearer(admin.accessToken),
    });
    expect(allowed.status).toBe(200);
  });
});

describe("PATCH /api/users/:id/role", () => {
  const patchRole = (token: string, id: string, role: string) =>
    app.request(`/api/users/${id}/role`, {
      method: "PATCH",
      headers: bearer(token),
      body: JSON.stringify({ role }),
    });

  it("promotes and demotes users, takes effect immediately and is audited", async () => {
    const user = await createTestUser();
    const admin = await loginAdmin();

    expect((await patchRole(admin.accessToken, user.user.id, "admin")).status).toBe(200);
    const list = await app.request("/api/users", { headers: bearer(user.accessToken) });
    expect(list.status).toBe(200);

    expect((await patchRole(admin.accessToken, user.user.id, "user")).status).toBe(200);
    const denied = await app.request("/api/users", { headers: bearer(user.accessToken) });
    expect(denied.status).toBe(403);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "ROLE_CHANGE", entityId: user.user.id },
    });
    expect(audit).not.toBeNull();
  });

  it("is admin-only, validates the role and rejects changing your own role", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    const admin = await loginAdmin();

    expect((await patchRole(user.accessToken, other.user.id, "admin")).status).toBe(403);
    expect((await patchRole(admin.accessToken, other.user.id, "superuser")).status).toBe(400);
    expect((await patchRole(admin.accessToken, admin.user.id, "user")).status).toBe(400);
    expect((await patchRole(admin.accessToken, randomUUID(), "admin")).status).toBe(404);
  });

  it("never demotes or suspends the last active administrator", async () => {
    // Isolate: the seeded admin plus one extra admin are the only active admins
    const extra = await createTestUser();
    await prisma.user.update({ where: { id: extra.user.id }, data: { role: "admin" } });
    const others = await prisma.user.findMany({
      where: { role: "admin", id: { notIn: ["user-1", extra.user.id] }, deletedAt: null },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: others.map((u) => u.id) } },
      data: { isBlocked: true },
    });

    try {
      const admin = await loginAdmin();
      // Both admins try to remove each other at the same time: exactly one may win
      const results = await Promise.all([
        patchRole(admin.accessToken, extra.user.id, "user"),
        patchRole(extra.accessToken, "user-1", "user"),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).not.toEqual([200, 200]);

      const remaining = await prisma.user.count({
        where: { role: "admin", isBlocked: false, deletedAt: null },
      });
      expect(remaining).toBeGreaterThanOrEqual(1);
    } finally {
      await prisma.user.update({ where: { id: "user-1" }, data: { role: "admin" } });
      await prisma.user.update({ where: { id: extra.user.id }, data: { isBlocked: true } });
      await prisma.user.updateMany({
        where: { id: { in: others.map((u) => u.id) } },
        data: { isBlocked: false },
      });
    }
  });
});

describe("Shared rate limit store", () => {
  it("two limiter instances with the same name share one counter", async () => {
    const name = `shared-${randomUUID()}`;
    const build = () => {
      const a = new Hono();
      a.use("*", rateLimiter(name, 60_000, 2));
      a.get("/", (c) => c.text("ok"));
      return a;
    };
    const nodeA = build();
    const nodeB = build();

    expect((await nodeA.request("/")).status).toBe(200);
    expect((await nodeB.request("/")).status).toBe(200);
    expect((await nodeA.request("/")).status).toBe(429);
    expect((await nodeB.request("/")).status).toBe(429);
  });

  it("counts concurrent hits without losing any and opens a new window after expiry", async () => {
    const key = `rl:test:${randomUUID()}`;
    await Promise.all(Array.from({ length: 10 }, () => hitBucket(key, 60_000)));
    expect((await peekBucket(key))?.count).toBe(10);

    await prisma.rateLimitBucket.update({ where: { key }, data: { resetAt: new Date(0) } });
    expect(await peekBucket(key)).toBeNull();
    expect((await hitBucket(key, 60_000)).count).toBe(1);
  });
});

describe("Cleanup job", () => {
  it("purges ended rate-limit windows and audit entries past the retention period", async () => {
    const key = `rl:old:${randomUUID()}`;
    await prisma.rateLimitBucket.create({ data: { key, count: 1, resetAt: new Date(0) } });
    const old = await prisma.auditLog.create({
      data: { action: "TEST", entity: "Test", createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const fresh = await prisma.auditLog.create({ data: { action: "TEST", entity: "Test" } });

    const result = await cleanupExpiredSessions();

    expect(result.deletedBuckets).toBeGreaterThanOrEqual(1);
    expect(result.deletedAuditLogs).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.findUnique({ where: { key } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});
