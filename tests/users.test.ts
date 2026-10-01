import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { app, bearer, createTestUser, jsonHeaders, login, loginAdmin } from "./helpers.js";

describe("User management", () => {
  it("changing the password revokes other sessions but keeps the current one", async () => {
    const user = await createTestUser();
    const otherDevice = await login(user.email, user.password);

    const res = await app.request(`/api/users/${user.user.id}`, {
      method: "PUT",
      headers: bearer(user.accessToken),
      body: JSON.stringify({ password: "new-password-456", currentPassword: user.password }),
    });
    expect(res.status).toBe(200);

    const current = await app.request("/api/sessions/me", { headers: bearer(user.accessToken) });
    expect(current.status).toBe(200);
    const other = await app.request("/api/sessions/me", {
      headers: bearer(otherDevice.accessToken),
    });
    expect(other.status).toBe(401);

    await expect(login(user.email, "new-password-456")).resolves.toBeDefined();
  });

  it("changing your own password requires the current one and changes nothing otherwise", async () => {
    const user = await createTestUser();
    const otherDevice = await login(user.email, user.password);

    for (const body of [
      { password: "new-password-456" },
      { password: "new-password-456", currentPassword: "wrong-password" },
    ]) {
      const res = await app.request(`/api/users/${user.user.id}`, {
        method: "PUT",
        headers: bearer(user.accessToken),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(403);
    }

    // Password unchanged and the other session still valid
    await expect(login(user.email, user.password)).resolves.toBeDefined();
    const other = await app.request("/api/sessions/me", {
      headers: bearer(otherDevice.accessToken),
    });
    expect(other.status).toBe(200);
  });

  it("an admin can reset another user's password without knowing the current one", async () => {
    const user = await createTestUser();
    const admin = await loginAdmin();

    const res = await app.request(`/api/users/${user.user.id}`, {
      method: "PUT",
      headers: bearer(admin.accessToken),
      body: JSON.stringify({ password: "reset-password-789" }),
    });
    expect(res.status).toBe(200);
    await expect(login(user.email, "reset-password-789")).resolves.toBeDefined();
  });

  it("rejects passwords longer than 72 bytes even when under 72 characters", async () => {
    // 40 emoji = 40 characters but 160 bytes: bcrypt would silently truncate it
    const res = await app.request("/api/auth/register", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        name: "Emoji User",
        email: `emoji-${Date.now()}@example.com`,
        password: "😀".repeat(40),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("never returns password hashes", async () => {
    const { accessToken } = await loginAdmin();
    const res = await app.request("/api/users?include=tasks", { headers: bearer(accessToken) });
    const data = await res.json();
    for (const user of data.data) expect(user.password).toBeUndefined();
  });

  it("soft-deleted users cannot be reactivated via unblock", async () => {
    const admin = await loginAdmin();
    const user = await createTestUser();

    const del = await app.request(`/api/users/${user.user.id}`, {
      method: "DELETE",
      headers: bearer(admin.accessToken),
    });
    expect(del.status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: user.user.id } })).toBe(0);

    const unblock = await app.request(`/api/users/${user.user.id}/block`, {
      method: "PATCH",
      headers: bearer(admin.accessToken),
      body: JSON.stringify({ isBlocked: false }),
    });
    expect(unblock.status).toBe(409);
  });

  it("the last active administrator cannot delete their own account", async () => {
    // Isolate: temporarily make the seeded admin the only active admin
    const otherAdmins = await prisma.user.findMany({
      where: { role: "admin", id: { not: "user-1" }, isBlocked: false, deletedAt: null },
      select: { id: true },
    });
    const otherIds = otherAdmins.map((a) => a.id);
    await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { isBlocked: true } });

    try {
      const admin = await loginAdmin();
      const res = await app.request("/api/users/user-1", {
        method: "DELETE",
        headers: bearer(admin.accessToken),
      });
      expect(res.status).toBe(409);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { isBlocked: false } });
    }
  });

  it("blocking a user records an audit entry and revokes sessions", async () => {
    const admin = await loginAdmin();
    const user = await createTestUser();

    const res = await app.request(`/api/users/${user.user.id}/block`, {
      method: "PATCH",
      headers: bearer(admin.accessToken),
      body: JSON.stringify({ isBlocked: true, reason: "Spam" }),
    });
    expect(res.status).toBe(200);

    const me = await app.request("/api/sessions/me", { headers: bearer(user.accessToken) });
    expect(me.status).toBe(403);

    // The suspended account can no longer sign in either
    const relogin = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    expect(relogin.status).toBe(403);

    const logs = await app.request(`/api/audit-logs?action=BLOCK&userId=${admin.user.id}`, {
      headers: bearer(admin.accessToken),
    });
    const data = await logs.json();
    expect(data.data.some((l: { entityId: string }) => l.entityId === user.user.id)).toBe(true);
  });
});

describe("Tasks soft delete & restore", () => {
  it("soft-deleted tasks are hidden from GET/PUT and can be restored", async () => {
    const { accessToken } = await createTestUser();
    const created = await app.request("/api/tasks", {
      method: "POST",
      headers: bearer(accessToken),
      body: JSON.stringify({ title: "Temporary task" }),
    });
    const { data: task } = await created.json();

    await app.request(`/api/tasks/${task.id}`, { method: "DELETE", headers: bearer(accessToken) });

    expect(
      (await app.request(`/api/tasks/${task.id}`, { headers: bearer(accessToken) })).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/tasks/${task.id}?includeDeleted=true`, {
          headers: bearer(accessToken),
        })
      ).status,
    ).toBe(200);
    const put = await app.request(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: bearer(accessToken),
      body: JSON.stringify({ completed: true }),
    });
    expect(put.status).toBe(404);

    const restore = await app.request(`/api/tasks/${task.id}/restore`, {
      method: "POST",
      headers: bearer(accessToken),
    });
    expect(restore.status).toBe(200);
    expect((await restore.json()).data.deletedAt).toBeNull();
  });

  it("users cannot restore tasks of other users", async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const created = await app.request("/api/tasks", {
      method: "POST",
      headers: bearer(owner.accessToken),
      body: JSON.stringify({ title: "Private task" }),
    });
    const { data: task } = await created.json();
    await app.request(`/api/tasks/${task.id}`, {
      method: "DELETE",
      headers: bearer(owner.accessToken),
    });

    const res = await app.request(`/api/tasks/${task.id}/restore`, {
      method: "POST",
      headers: bearer(intruder.accessToken),
    });
    expect(res.status).toBe(403);
  });
});

describe("Task search", () => {
  it("?search matches title and description within the owner's own tasks", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const create = (token: string, title: string, description = "") =>
      app.request("/api/tasks", {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({ title, description }),
      });
    await create(owner.accessToken, "Quarterly report");
    await create(owner.accessToken, "Groceries", "buy report paper");
    await create(owner.accessToken, "Unrelated task");
    await create(other.accessToken, "Someone else's report");

    const res = await app.request("/api/tasks?search=report", {
      headers: bearer(owner.accessToken),
    });
    const { data, pagination } = await res.json();
    expect(pagination.total).toBe(2);
    expect(data.map((t: { title: string }) => t.title).sort()).toEqual([
      "Groceries",
      "Quarterly report",
    ]);
  });
});
