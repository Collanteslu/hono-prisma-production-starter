import SwaggerParser from "@apidevtools/swagger-parser";
import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import {
  auditLogSchema,
  errorSchema,
  healthResponseSchema,
  loginResponseSchema,
  refreshResponseSchema,
  sessionListResponseSchema,
  successSchema,
  taskSchema,
  userSchema,
} from "../src/schemas/responses.js";
import { app, bearer, createTestUser, jsonHeaders, loginAdmin } from "./helpers.js";

type Spec = { paths: Record<string, Record<string, { security?: unknown[] }>> };

async function getSpec() {
  const res = await app.request("/openapi.json");
  expect(res.status).toBe(200);
  return (await res.json()) as Spec;
}

/** Asserts that a real response body satisfies the documented response schema */
function expectMatches(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  expect(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2)).toBe(
    true,
  );
}

describe("OpenAPI specification", () => {
  it("is a valid OpenAPI document", async () => {
    const spec = await getSpec();
    await expect(SwaggerParser.validate(structuredClone(spec) as never)).resolves.toBeDefined();
  });

  it("documents every registered route (no drift between code and spec)", async () => {
    const spec = await getSpec();
    const documented = new Set(
      Object.entries(spec.paths).flatMap(([path, ops]) =>
        Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );

    const undocumented = app.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`)
      .filter((route) => {
        const path = route.split(" ")[1];
        return (path.startsWith("/api") || path === "/healthz") && !documented.has(route);
      });

    expect(undocumented).toEqual([]);
  });

  it("marks every protected route with the BearerAuth security scheme", async () => {
    const spec = await getSpec();
    for (const [path, ops] of Object.entries(spec.paths)) {
      const isPublic =
        path === "/healthz" || (path.startsWith("/api/auth") && !path.startsWith("/api/auth/mfa"));
      for (const [method, op] of Object.entries(ops)) {
        expect(Boolean(op.security?.length), `${method} ${path}`).toBe(!isPublic);
      }
    }
  });
});

describe("Responses satisfy the documented schemas", () => {
  it("auth: register, login, refresh, sessions", async () => {
    const email = `contract-${Date.now()}@example.com`;
    const register = await app.request("/api/auth/register", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "Contract", email, password: "password123" }),
    });
    expect(register.status).toBe(201);
    expectMatches(successSchema(userSchema), await register.json());

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password: "password123" }),
    });
    const loginBody = await login.json();
    expectMatches(loginResponseSchema, loginBody);

    const sessions = await app.request("/api/sessions/me", {
      headers: bearer(loginBody.accessToken),
    });
    expectMatches(sessionListResponseSchema, await sessions.json());

    const refresh = await app.request("/api/auth/refresh", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
    });
    expect(refresh.status).toBe(200);
    expectMatches(refreshResponseSchema, await refresh.json());
  });

  it("tasks: create, list (with include), get, soft delete, permanent delete", async () => {
    const { accessToken } = await createTestUser();
    const headers = bearer(accessToken);

    const created = await app.request("/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Contract task" }),
    });
    const { data: task } = await created.json();
    expectMatches(successSchema(taskSchema), { success: true, data: task, meta: fakeMeta() });

    const list = await app.request("/api/tasks?include=user", { headers });
    const listBody = await list.json();
    expectMatches(successSchema(z.array(taskSchema)), listBody);
    expect(listBody.pagination.total).toBeGreaterThan(0);

    const get = await app.request(`/api/tasks/${task.id}`, { headers });
    expectMatches(successSchema(taskSchema), await get.json());

    const soft = await app.request(`/api/tasks/${task.id}`, { method: "DELETE", headers });
    expectMatches(successSchema(taskSchema), await soft.json());

    const hard = await app.request(`/api/tasks/${task.id}?permanent=true`, {
      method: "DELETE",
      headers,
    });
    expect(hard.status).toBe(200);
    expect((await hard.json()).data).toEqual({ id: task.id, deletedPermanently: true });
  });

  it("users and audit logs (admin)", async () => {
    const { accessToken, user } = await loginAdmin();
    const headers = bearer(accessToken);

    const users = await app.request("/api/users?include=tasks,sessions", { headers });
    expectMatches(successSchema(z.array(userSchema)), await users.json());

    const one = await app.request(`/api/users/${user.id}`, { headers });
    expectMatches(successSchema(userSchema), await one.json());

    const audit = await app.request("/api/audit-logs?limit=5", { headers });
    expectMatches(successSchema(z.array(auditLogSchema)), await audit.json());
  });

  it("healthcheck", async () => {
    const res = await app.request("/healthz");
    expectMatches(healthResponseSchema, await res.json());
  });

  it("errors: validation, auth and not-found envelopes match the Error schema", async () => {
    const validation = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email: "not-an-email", password: "" }),
    });
    expect(validation.status).toBe(400);
    const validationBody = await validation.json();
    expectMatches(errorSchema, validationBody);
    expect(validationBody.errors.email).toBeDefined();

    const unauthorized = await app.request("/api/tasks");
    expect(unauthorized.status).toBe(401);
    expectMatches(errorSchema, await unauthorized.json());

    const notFound = await app.request("/nope");
    expect(notFound.status).toBe(404);
    expectMatches(errorSchema, await notFound.json());
  });
});

function fakeMeta() {
  return { requestId: "x", timestamp: new Date().toISOString(), durationMs: 1 };
}
