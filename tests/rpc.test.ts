import { hc } from "hono/client";
import { describe, expect, it } from "vitest";
import type { AppType } from "../src/index.js";
import { app, createTestUser } from "./helpers.js";

/**
 * The Hono RPC client (`hc<AppType>`) is type-checked by `npm run typecheck` (tests/tsconfig.json):
 * if `AppType` stops carrying the route schemas, this file no longer compiles.
 * At runtime it also proves the documented client usage works against the real app.
 */
const client = (token?: string) =>
  hc<AppType>("http://localhost", {
    fetch: app.request,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

describe("Hono RPC client (hc<AppType>)", () => {
  it("performs a fully typed login, create and list flow", async () => {
    const user = await createTestUser();
    const api = client(user.accessToken);

    const login = await client().api.auth.login.$post({
      json: { email: user.email, password: user.password },
    });
    expect(login.ok).toBe(true);
    if (login.ok) expect((await login.json()).accessToken).toBeTypeOf("string");

    const created = await api.api.tasks.$post({ json: { title: "Typed RPC task" } });
    expect(created.status).toBe(201);
    if (created.status === 201) expect((await created.json()).data.title).toBe("Typed RPC task");

    const list = await api.api.tasks.$get({ query: { limit: "10", completed: "false" } });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const { data, pagination } = await list.json();
      expect(data[0].title).toBe("Typed RPC task");
      expect(pagination?.total).toBe(1);
    }
  });

  it("types the healthcheck, whose route is registered before the router is chained", async () => {
    const res = await client().healthz.$get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.database.latencyMs).toBeTypeOf("number");
  });

  it("narrows error responses by status code", async () => {
    const user = await createTestUser();
    const res = await client(user.accessToken).api.tasks[":id"].$get({
      param: { id: "does-not-exist" },
      query: {},
    });
    expect(res.status).toBe(404);
    if (res.status === 404) expect((await res.json()).success).toBe(false);
  });
});
