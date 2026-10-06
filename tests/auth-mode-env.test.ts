import { describe, expect, it, vi } from "vitest";
import { app } from "./helpers.js";

/** Loads src/config/env.ts with extra variables; returns the parsed env or the startup error */
async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const mod = await import("../src/config/env.js");
    return { env: mod.env, features: mod.features, error: null };
  } catch {
    return { env: null, features: null, error: consoleError.mock.calls.flat().join("\n") };
  } finally {
    exit.mockRestore();
    consoleError.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

const noSecrets = { JWT_SECRET: "", JWT_REFRESH_SECRET: "" };

describe("AUTH_MODE configuration", () => {
  it("defaults to full (the previous behaviour) and the default app mounts everything", async () => {
    const { env, features } = await loadEnv({ AUTH_MODE: "" });
    expect(env?.AUTH_MODE).toBe("full");
    expect(features).toEqual({ auth: true, accountSecurity: true });

    const body = (await (await app.request("/")).json()) as { authMode: string };
    expect(body.authMode).toBe("full");
  });

  it("rejects unknown modes", async () => {
    const { error } = await loadEnv({ AUTH_MODE: "partial" });
    expect(error).toContain("AUTH_MODE");
  });

  it("requires the JWT secrets unless AUTH_MODE=none", async () => {
    for (const mode of ["basic", "full"]) {
      const { error } = await loadEnv({ AUTH_MODE: mode, ...noSecrets });
      expect(error, mode).toContain("JWT_SECRET is required unless AUTH_MODE=none");
    }
    const none = await loadEnv({ AUTH_MODE: "none", ...noSecrets });
    expect(none.error).toBeNull();
    expect(none.features).toEqual({ auth: false, accountSecurity: false });
    // Never a guessable value: a random per-process secret nothing uses
    expect(none.env?.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    const again = await loadEnv({ AUTH_MODE: "none", ...noSecrets });
    expect(again.env?.JWT_SECRET).not.toBe(none.env?.JWT_SECRET);
  });

  it("rejects identical signing secrets in every environment", async () => {
    const shared = "a".repeat(48);
    for (const mode of ["basic", "full"]) {
      const { env, error } = await loadEnv({
        AUTH_MODE: mode,
        JWT_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      });
      expect(error, mode).toContain("JWT_REFRESH_SECRET must differ from JWT_SECRET");
      expect(env, mode).toBeNull();
    }
    // AUTH_MODE=none signs nothing, so identical (or absent) secrets stay acceptable
    const none = await loadEnv({
      AUTH_MODE: "none",
      JWT_SECRET: shared,
      JWT_REFRESH_SECRET: shared,
    });
    expect(none.error).toBeNull();
  });

  it("starts in production without secrets when AUTH_MODE=none", async () => {
    const { error } = await loadEnv({
      NODE_ENV: "production",
      AUTH_MODE: "none",
      MAIL_TRANSPORT: "none",
      ...noSecrets,
    });
    expect(error).toBeNull();
  });

  it("rejects the admin bootstrap with AUTH_MODE=none (there are no users)", async () => {
    const { error } = await loadEnv({ AUTH_MODE: "none", ADMIN_EMAIL: "admin@example.com" });
    expect(error).toContain("no effect with AUTH_MODE=none");
  });

  it("only allows REQUIRE_EMAIL_VERIFICATION with AUTH_MODE=full", async () => {
    for (const mode of ["none", "basic"]) {
      const { error } = await loadEnv({ AUTH_MODE: mode, REQUIRE_EMAIL_VERIFICATION: "true" });
      expect(error, mode).toContain("REQUIRE_EMAIL_VERIFICATION needs AUTH_MODE=full");
    }
    const full = await loadEnv({ AUTH_MODE: "full", REQUIRE_EMAIL_VERIFICATION: "true" });
    expect(full.error).toBeNull();
  });

  it("only requires an https APP_URL for SMTP in production with AUTH_MODE=full", async () => {
    const smtp = {
      NODE_ENV: "production",
      MAIL_TRANSPORT: "smtp",
      SMTP_URL: "smtp://localhost:2525",
    };
    expect((await loadEnv({ ...smtp, AUTH_MODE: "full", APP_URL: "" })).error).toContain(
      "APP_URL is required",
    );
    expect((await loadEnv({ ...smtp, AUTH_MODE: "basic", APP_URL: "" })).error).toBeNull();
  });
});
