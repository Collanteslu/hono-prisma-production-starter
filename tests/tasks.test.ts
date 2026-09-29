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
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.pagination).toBeDefined();
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
});
