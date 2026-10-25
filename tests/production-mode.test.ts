import { afterEach, describe, expect, it, vi } from "vitest";

// NODE_ENV and ENABLE_DOCS are read once at startup, so each case loads a fresh copy of the app
type App = typeof import("../src/app.js")["default"];

async function loadApp(env: Record<string, string>, infoSink: string[] = []): Promise<App> {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  // Capture what the access logger writes (the test logger is silent otherwise)
  vi.doMock("../src/lib/logger.js", () => {
    const logger = {
      info: (line: unknown) => infoSink.push(String(line)),
      warn: () => {},
      error: () => {},
      debug: () => {},
      fatal: () => {},
    };
    return { logger, default: logger };
  });
  return (await import("../src/app.js")).default;
}

afterEach(() => {
  vi.doUnmock("../src/lib/logger.js");
  vi.unstubAllEnvs();
});

describe("NODE_ENV=production", () => {
  it("does not advertise /docs on GET / while the docs are disabled (the default)", async () => {
    const app = await loadApp({ NODE_ENV: "production", MAIL_TRANSPORT: "none", ENABLE_DOCS: "" });
    expect((await app.request("/docs")).status).toBe(404);

    const body = (await (await app.request("/")).json()) as {
      documentationUrl?: string;
      endpoints: Record<string, unknown>;
    };
    expect(body.documentationUrl).toBeUndefined();
    expect(body.endpoints.documentation).toBeUndefined();
    expect(body.endpoints.healthcheck).toBe("/healthz");
  });

  it("advertises /docs on GET / when ENABLE_DOCS=true", async () => {
    const app = await loadApp({
      NODE_ENV: "production",
      MAIL_TRANSPORT: "none",
      ENABLE_DOCS: "true",
    });
    expect((await app.request("/docs")).status).toBe(200);

    const body = (await (await app.request("/")).json()) as {
      documentationUrl?: string;
      endpoints: Record<string, unknown>;
    };
    expect(body.documentationUrl).toBe("/docs");
    expect(body.endpoints.documentation).toBe("/docs");
  });

  it("writes access-log lines without ANSI colour escapes", async () => {
    const lines: string[] = [];
    const app = await loadApp(
      { NODE_ENV: "production", MAIL_TRANSPORT: "none", ENABLE_DOCS: "" },
      lines,
    );
    await app.request("/healthz");

    const esc = String.fromCharCode(27);
    expect(lines.some((line) => line.includes("/healthz"))).toBe(true);
    expect(lines.filter((line) => line.includes(esc))).toEqual([]);
  });
});

describe("outside production", () => {
  it("advertises /docs on GET /", async () => {
    const app = await loadApp({ NODE_ENV: "test" });
    const body = (await (await app.request("/")).json()) as { documentationUrl?: string };
    expect(body.documentationUrl).toBe("/docs");
  });
});
