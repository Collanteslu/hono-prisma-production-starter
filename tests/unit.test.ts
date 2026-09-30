import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
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

    const first = await app.request("/");
    expect(first.status).toBe(200);
    expect(first.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(first.headers.get("X-RateLimit-Remaining")).toBe("1");
    const second = await app.request("/");
    expect(second.status).toBe(200);
    expect(second.headers.get("X-RateLimit-Remaining")).toBe("0");
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

describe("client IP resolution behind a proxy", () => {
  it("pickForwardedIp reads X-Forwarded-For from the right and ignores spoofed entries", async () => {
    const { pickForwardedIp } = await import("../src/lib/clientIp.js");
    // The client sent "6.6.6.6"; the trusted proxy appended the address it actually saw
    expect(pickForwardedIp("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9");
    // Two trusted proxies (e.g. Cloudflare + Traefik): "client, cloudflare-edge"
    expect(pickForwardedIp("203.0.113.9, 172.70.0.1", 2)).toBe("203.0.113.9");
    expect(pickForwardedIp("1.1.1.1, 203.0.113.9, 172.70.0.1", 2)).toBe("203.0.113.9");
    // Header shorter than the trusted chain: do not guess, fall back to the socket address
    expect(pickForwardedIp("203.0.113.9", 2)).toBeUndefined();
    expect(pickForwardedIp(undefined, 1)).toBeUndefined();
    expect(pickForwardedIp(" , ", 1)).toBeUndefined();
  });

  it("with TRUST_PROXY, getClientIp ignores CF-Connecting-IP / X-Real-IP and the leftmost XFF entry", async () => {
    vi.resetModules();
    vi.stubEnv("TRUST_PROXY", "true");
    vi.stubEnv("TRUST_PROXY_HOPS", "1");
    try {
      const { getClientIp } = await import("../src/lib/clientIp.js");
      const headers: Record<string, string> = {
        "x-forwarded-for": "6.6.6.6, 203.0.113.9",
        "cf-connecting-ip": "7.7.7.7",
        "x-real-ip": "8.8.8.8",
      };
      const ctx = { req: { header: (name: string) => headers[name.toLowerCase()] } };
      expect(getClientIp(ctx as never)).toBe("203.0.113.9");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
