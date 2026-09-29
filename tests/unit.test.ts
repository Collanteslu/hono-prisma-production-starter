import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { parseFilters, parseSorting } from "../src/lib/query.js";
import { createLoginLockout, rateLimiter } from "../src/middleware/rateLimit.js";

describe("parseFilters", () => {
  const options = {
    allowedFields: {
      title: "string",
      completed: "boolean",
      createdAt: "date",
      priority: "number",
    } as const,
  };

  it("coerces values according to the field type", () => {
    expect(
      parseFilters(
        {
          "filter[completed]": "true",
          "filter[title][contains]": "hono",
          "filter[priority][in]": "1, 2",
          "filter[createdAt][gte]": "2026-01-01",
        },
        options,
      ),
    ).toEqual({
      completed: true,
      title: { contains: "hono" },
      priority: { in: [1, 2] },
      createdAt: { gte: new Date("2026-01-01") },
    });
  });

  it("ignores fields outside the whitelist", () => {
    expect(
      parseFilters({ "filter[userId]": "someone-else", "filter[__proto__]": "x" }, options),
    ).toEqual({});
  });

  it("throws HTTP 400 for unsupported operators or malformed values", () => {
    expect(() => parseFilters({ "filter[completed][contains]": "t" }, options)).toThrow(
      HTTPException,
    );
    expect(() => parseFilters({ "filter[priority]": "high" }, options)).toThrow(HTTPException);
    expect(() => parseFilters({ "filter[createdAt][lte]": "nope" }, options)).toThrow(
      HTTPException,
    );
  });
});

describe("parseSorting", () => {
  it("returns one orderBy object per field, ignoring unknown and duplicate fields", () => {
    expect(
      parseSorting("-createdAt,title,password,title", { allowedFields: ["createdAt", "title"] }),
    ).toEqual([{ createdAt: "desc" }, { title: "asc" }]);
  });

  it("falls back to the default sort", () => {
    expect(parseSorting(undefined, { allowedFields: ["title"] })).toEqual([{ createdAt: "desc" }]);
  });
});

describe("rateLimiter", () => {
  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    const app = new Hono();
    app.use("*", rateLimiter(60_000, 2));
    app.get("/", (c) => c.text("ok"));

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    const limited = await app.request("/");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("createLoginLockout", () => {
  it("locks after the maximum number of failures and resets on success", () => {
    const lockout = createLoginLockout(2, 60_000);
    lockout.recordFailure("a@example.com");
    expect(lockout.retryAfterSeconds("a@example.com")).toBe(0);
    lockout.recordFailure("a@example.com");
    expect(lockout.retryAfterSeconds("a@example.com")).toBeGreaterThan(0);
    lockout.reset("a@example.com");
    expect(lockout.retryAfterSeconds("a@example.com")).toBe(0);
  });
});
