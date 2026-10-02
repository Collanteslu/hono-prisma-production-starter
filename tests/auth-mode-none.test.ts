import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// AUTH_MODE is read once at startup, so this file loads the app with AUTH_MODE=none
type App = typeof import("../src/index.js")["default"];
let app: App;
let prisma: typeof import("../src/db.js")["prisma"];

beforeAll(async () => {
  vi.stubEnv("AUTH_MODE", "none");
  vi.resetModules();
  app = (await import("../src/index.js")).default;
  prisma = (await import("../src/db.js")).prisma;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const json = { "Content-Type": "application/json" };
const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: json, body: body ? JSON.stringify(body) : undefined });

type Spec = {
  paths: Record<string, Record<string, { security?: unknown[]; responses: object }>>;
  components?: { securitySchemes?: Record<string, unknown> };
};

describe("AUTH_MODE=none", () => {
  it("does not mount any auth, user, session, recovery, MFA or audit route", async () => {
    for (const [method, path] of [
      ["POST", "/api/auth/register"],
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/refresh"],
      ["POST", "/api/auth/forgot-password"],
      ["POST", "/api/auth/verify-email"],
      ["POST", "/api/auth/mfa/setup"],
      ["GET", "/api/sessions/me"],
      ["GET", "/api/users"],
      ["DELETE", "/api/users/user-1/mfa"],
      ["GET", "/api/audit-logs"],
    ] as const) {
      const res = await send(method, path, method === "GET" ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("serves the tasks example publicly, without owner", async () => {
    const created = await send("POST", "/api/tasks", { title: "Public task" });
    expect(created.status).toBe(201);
    const task = (await created.json()).data as { id: string; userId: string | null };
    expect(task.userId).toBeNull();

    expect((await send("GET", `/api/tasks/${task.id}`)).status).toBe(200);
    const list = (await (await send("GET", "/api/tasks?limit=100")).json()).data as {
      id: string;
      userId: string | null;
    }[];
    expect(list.some((t) => t.id === task.id)).toBe(true);
    expect(list.every((t) => t.userId === null)).toBe(true);

    expect((await send("PUT", `/api/tasks/${task.id}`, { completed: true })).status).toBe(200);
    expect((await send("DELETE", `/api/tasks/${task.id}`)).status).toBe(200);
    expect((await send("POST", `/api/tasks/${task.id}/restore`)).status).toBe(200);
    expect((await send("DELETE", `/api/tasks/${task.id}?permanent=true`)).status).toBe(200);
    expect((await send("GET", `/api/tasks/${task.id}`)).status).toBe(404);
  });

  it("seeds public example tasks outside production", async () => {
    const list = (await (await send("GET", "/api/tasks?limit=100")).json()).data as {
      title: string;
    }[];
    expect(list.map((t) => t.title)).toContain("Explore the public API");
  });

  it("never exposes tasks that belong to users, nor the admin-only filters", async () => {
    // A task owned by a user (e.g. created earlier with AUTH_MODE=basic/full)
    const owner = await prisma.user.create({
      data: { name: "Owner", email: `owner-${randomUUID()}@example.com`, password: "x" },
    });
    const owned = await prisma.task.create({ data: { title: "Private", userId: owner.id } });

    expect((await send("GET", `/api/tasks/${owned.id}`)).status).toBe(404);
    expect((await send("PUT", `/api/tasks/${owned.id}`, { completed: true })).status).toBe(404);
    expect((await send("DELETE", `/api/tasks/${owned.id}`)).status).toBe(404);
    const list = (await (await send("GET", "/api/tasks?limit=100")).json()).data as {
      id: string;
    }[];
    expect(list.some((t) => t.id === owned.id)).toBe(false);
    expect((await send("GET", "/api/tasks?scope=all")).status).toBe(400);
    expect((await send("GET", "/api/tasks?userId=user-1")).status).toBe(400);
  });

  it("publishes only the mounted routes, all public", async () => {
    const spec = (await (await app.request("/openapi.json")).json()) as Spec;
    const paths = Object.keys(spec.paths).sort();
    expect(paths).toEqual(["/api/tasks", "/api/tasks/{id}", "/api/tasks/{id}/restore", "/healthz"]);
    expect(spec.components?.securitySchemes?.BearerAuth).toBeUndefined();
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        expect(op.security?.length ?? 0, `${method} ${path}`).toBe(0);
        expect(Object.keys(op.responses), `${method} ${path}`).not.toContain("401");
      }
    }
  });

  it("lists only the mounted endpoints in GET /", async () => {
    const body = (await (await app.request("/")).json()) as {
      authMode: string;
      endpoints: Record<string, unknown>;
    };
    expect(body.authMode).toBe("none");
    expect(Object.keys(body.endpoints).sort()).toEqual(
      ["documentation", "healthcheck", "restoreTask", "tasks"].sort(),
    );
  });
});
