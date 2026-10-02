import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { errorSchema } from "../src/schemas/responses.js";
import { app, bearer, createTestUser } from "./helpers.js";

type Spec = { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };

async function getSpec() {
  const res = await app.request("/openapi.json");
  expect(res.status).toBe(200);
  return (await res.json()) as Spec;
}

/** Every `METHOD /path` pair documented in the spec (paths keep their `{param}` placeholders) */
async function documentedOperations() {
  const spec = await getSpec();
  return Object.entries(spec.paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => ({ method: method.toUpperCase(), path })),
  );
}

describe("MFA routes document the suspended-account 403", () => {
  it("declares 403 on setup, enable and disable", async () => {
    const spec = await getSpec();
    for (const op of ["setup", "enable", "disable"]) {
      const responses = spec.paths[`/api/auth/mfa/${op}`]?.post?.responses ?? {};
      expect(Object.keys(responses), op).toContain("403");
    }
  });

  it("answers a suspended account with the documented 403 envelope", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.user.id }, data: { isBlocked: true } });

    const res = await app.request("/api/auth/mfa/enable", {
      method: "POST",
      headers: bearer(user.accessToken),
      body: JSON.stringify({ code: "123456" }),
    });
    expect(res.status).toBe(403);
    expect(errorSchema.safeParse(await res.json()).success).toBe(true);
  });
});

describe("GET / endpoint index", () => {
  it("lists the recovery, verification and MFA endpoints", async () => {
    const body = JSON.stringify(await (await app.request("/")).json());
    for (const endpoint of [
      "POST /api/auth/forgot-password",
      "POST /api/auth/reset-password",
      "POST /api/auth/verify-email",
      "POST /api/auth/resend-verification",
      "POST /api/auth/mfa/setup",
      "POST /api/auth/mfa/enable",
      "POST /api/auth/mfa/disable",
      "DELETE /api/users/:id/mfa",
    ]) {
      expect(body, endpoint).toContain(endpoint);
    }
  });

  it("only lists endpoints that exist", async () => {
    const { endpoints } = (await (await app.request("/")).json()) as { endpoints: unknown };
    const listed: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") listed.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(endpoints);

    const documented = new Set(
      (await documentedOperations()).map(({ method, path }) => `${method} ${path}`),
    );
    for (const entry of listed) {
      const match = /^([A-Z, ]+) (\/api\/\S+)$/.exec(entry);
      if (!match) continue; // plain paths such as /healthz or /docs
      const path = (match[2] as string).replace(/:(\w+)/g, "{$1}");
      for (const method of (match[1] as string).split(",").map((m) => m.trim())) {
        // "GET, POST, PUT, DELETE /api/users" covers both the collection and /{id}
        const exists =
          documented.has(`${method} ${path}`) || documented.has(`${method} ${path}/{id}`);
        expect(exists, `${method} ${path}`).toBe(true);
      }
    }
  });
});

describe("Bruno collection", () => {
  it("has a request for every /api/auth endpoint", async () => {
    const dir = join(import.meta.dirname, "..", "bruno", "Auth");
    const requests = readdirSync(dir)
      .filter((file) => file.endsWith(".bru"))
      .map((file) => {
        const text = readFileSync(join(dir, file), "utf8");
        const match = /^(get|post|put|patch|delete) \{\s*url: \{\{baseUrl\}\}(\S+)/m.exec(text);
        return match ? `${(match[1] as string).toUpperCase()} ${match[2]}` : null;
      });

    const authOps = (await documentedOperations()).filter(({ path }) =>
      path.startsWith("/api/auth/"),
    );
    expect(authOps.length).toBeGreaterThan(0);
    for (const { method, path } of authOps) {
      expect(requests, `${method} ${path}`).toContain(`${method} ${path}`);
    }
  });
});
