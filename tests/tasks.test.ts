import { describe, expect, it } from "vitest";
import app from "../src/index.js";

describe("Tasks CRUD & Ownership API", () => {
  let userToken = "";
  let createdTaskId = "";

  it("Should login as normal user to obtain JWT", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ana@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    userToken = data.accessToken;
  });

  it("GET /api/tasks should return paginated tasks belonging to user", async () => {
    const res = await app.request("/api/tasks?limit=5", {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Response-Time")).toBeDefined();
    expect(res.headers.get("Server-Timing")).toContain("total;dur=");

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.pagination).toBeDefined();
    expect(data.meta).toBeDefined();
    expect(data.meta.durationMs).toBeTypeOf("number");
    expect(data.meta.requestId).toBeTypeOf("string");
    expect(data.meta.timestamp).toBeTypeOf("string");
  });

  it("POST /api/tasks should create a task associated with authenticated user", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        title: "Test Task from Vitest",
        description: "Automated test description",
        completed: false,
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.title).toBe("Test Task from Vitest");
    createdTaskId = data.data.id;
  });

  it("DELETE /api/tasks/:id should delete task owned by user", async () => {
    const res = await app.request(`/api/tasks/${createdTaskId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    expect(res.status).toBe(200);
  });

  it("GET /api/tasks?include=user should expand relational user object in each task", async () => {
    const res = await app.request("/api/tasks?limit=2&include=user", {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.data[0].user).toBeDefined();
    expect(data.data[0].user.email).toBeDefined();
    expect(data.data[0].user.password).toBeUndefined(); // Sensitive fields protected
  });

  it("GET /api/tasks?filter[completed]=true should filter tasks dynamically", async () => {
    // Seed a completed task: with no matching row the assertion below would pass vacuously
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Completed task for the filter test",
        completed: true,
      }),
    });
    expect(createRes.status).toBe(201);

    const res = await app.request("/api/tasks?filter[completed]=true", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const task of body.data) {
      expect(task.completed).toBe(true);
    }
  });

  it("DELETE /api/tasks/:id should soft delete by default, and exclude it from normal listings", async () => {
    // 1. Create a task to delete
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Task to be soft deleted",
        description: "Soft deletion test",
      }),
    });
    const created = await createRes.json();
    const taskId = created.data.id;

    // 2. Soft delete
    const delRes = await app.request(`/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.data.deletedAt).not.toBeNull();

    // 3. Normal list should NOT contain the task
    const listRes = await app.request("/api/tasks", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });
    const listBody = await listRes.json();
    const found = listBody.data.find((t: { id: string }) => t.id === taskId);
    expect(found).toBeUndefined();

    // 4. Listing with includeDeleted=true should contain the task
    const listWithDeletedRes = await app.request("/api/tasks?includeDeleted=true", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });
    const listWithDeletedBody = await listWithDeletedRes.json();
    const foundDeleted = listWithDeletedBody.data.find((t: { id: string }) => t.id === taskId);
    expect(foundDeleted).toBeDefined();
    expect(foundDeleted.deletedAt).not.toBeNull();
  });
});
