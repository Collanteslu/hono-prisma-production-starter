import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { cleanupExpiredSessions } from "../src/jobs/cleanup.js";
import { outbox } from "../src/lib/mailer.js";
import { generateRecoveryCodes, hashRecoveryCode, totpCode } from "../src/lib/totp.js";
import { app, bearer, createTestUser, jsonHeaders, login } from "./helpers.js";

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: "POST",
    headers: token ? bearer(token) : jsonHeaders,
    body: JSON.stringify(body),
  });

/** Gives background work time to run, to assert that nothing was sent */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** Starts a 2FA setup for a fresh user and returns the TOTP secret */
async function startSetup() {
  const user = await createTestUser();
  const setup = await post(
    "/api/auth/mfa/setup",
    { currentPassword: user.password },
    user.accessToken,
  );
  const { secret } = (await setup.json()).data as { secret: string };
  return { user, secret };
}

describe("APP_URL in production with SMTP", () => {
  /** Loads src/config/env.ts with extra variables; returns the startup error text, if any */
  async function loadEnv(vars: Record<string, string>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { env } = await import("../src/config/env.js");
      return { env, error: null };
    } catch {
      return { env: null, error: consoleError.mock.calls.flat().join("\n") };
    } finally {
      exit.mockRestore();
      consoleError.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  }

  const productionSmtp = {
    NODE_ENV: "production",
    MAIL_TRANSPORT: "smtp",
    SMTP_URL: "smtp://localhost:2525",
  };

  it("refuses to start without APP_URL", async () => {
    const { error } = await loadEnv({ ...productionSmtp, APP_URL: "" });
    expect(error).toContain("APP_URL is required in production");
  });

  it("refuses a plain-http APP_URL", async () => {
    const { error } = await loadEnv({ ...productionSmtp, APP_URL: "http://app.example.com" });
    expect(error).toContain("APP_URL must use https");
  });

  it("accepts an https APP_URL, and keeps the localhost default outside that case", async () => {
    const ok = await loadEnv({ ...productionSmtp, APP_URL: "https://app.example.com" });
    expect(ok.error).toBeNull();
    expect(ok.env?.APP_URL).toBe("https://app.example.com");

    const dev = await loadEnv({ APP_URL: "" });
    expect(dev.error).toBeNull();
    expect(dev.env?.APP_URL).toBe("http://localhost:3000");
  });
});

describe("MFA hardening", () => {
  it("two concurrent confirmations of the same setup: one wins, the other gets 409", async () => {
    const { user, secret } = await startSetup();
    const code = totpCode(secret);

    // Force the race: both requests read the pending setup before either of them writes
    const original = prisma.user.findUniqueOrThrow.bind(prisma.user);
    let release: () => void = () => {};
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const spy = vi.spyOn(prisma.user, "findUniqueOrThrow").mockImplementation((async (
      args: Parameters<typeof original>[0],
    ) => {
      const row = await original(args);
      if (++reads === 2) release();
      await bothRead;
      return row;
    }) as never);

    const responses = await Promise.all([
      post("/api/auth/mfa/enable", { code }, user.accessToken),
      post("/api/auth/mfa/enable", { code }, user.accessToken),
    ]);
    spy.mockRestore();
    expect(reads).toBe(2);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);

    const winner = responses.find((r) => r.status === 200) as Response;
    const { recoveryCodes } = (await winner.json()).data as { recoveryCodes: string[] };
    // The codes handed out are exactly the ones stored
    const stored = await prisma.recoveryCode.findMany({ where: { userId: user.user.id } });
    expect(stored).toHaveLength(10);
    expect(stored.map((r) => r.codeHash).sort()).toEqual(
      recoveryCodes.map((rc) => hashRecoveryCode(rc)).sort(),
    );
  });

  it("recovery codes carry 80 random bits (16 base32 characters) and still sign in", async () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);

    const { user, secret } = await startSetup();
    const enable = await post("/api/auth/mfa/enable", { code: totpCode(secret) }, user.accessToken);
    const { recoveryCodes } = (await enable.json()).data as { recoveryCodes: string[] };
    for (const code of recoveryCodes) expect(code).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);
    await expect(
      login(user.email, user.password, { recoveryCode: recoveryCodes[0] as string }),
    ).resolves.toBeDefined();
  });

  it("recovery code hashes are unique per user, not across users", async () => {
    const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
    const codeHash = hashRecoveryCode(`shared-${randomUUID()}`);
    await prisma.recoveryCode.create({ data: { userId: a.user.id, codeHash } });
    // Another user may hold the same hash (a collision must not break their enrolment)...
    await expect(
      prisma.recoveryCode.create({ data: { userId: b.user.id, codeHash } }),
    ).resolves.toBeDefined();
    // ...but one user cannot hold it twice
    await expect(
      prisma.recoveryCode.create({ data: { userId: a.user.id, codeHash } }),
    ).rejects.toThrow();
  });

  it("an admin cannot strip their own 2FA through the admin endpoint", async () => {
    const { user, secret } = await startSetup();
    expect(
      (await post("/api/auth/mfa/enable", { code: totpCode(secret) }, user.accessToken)).status,
    ).toBe(200);
    // The role is read from the database on every request, so the token now acts as an admin
    await prisma.user.update({ where: { id: user.user.id }, data: { role: "admin" } });

    const res = await app.request(`/api/users/${user.user.id}/mfa`, {
      method: "DELETE",
      headers: bearer(user.accessToken),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain("/api/auth/mfa/disable");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.user.id } });
    expect(row.totpEnabledAt).not.toBeNull();
  });
});

describe("Verification emails", () => {
  it("are not resent to suspended accounts", async () => {
    const user = await createTestUser();
    await prisma.user.update({
      where: { id: user.user.id },
      data: { isBlocked: true, emailVerifiedAt: null },
    });
    await settle(); // let the registration email go out first
    const before = outbox.length;
    expect((await post("/api/auth/resend-verification", { email: user.email })).status).toBe(202);
    await settle();
    expect(outbox.slice(before).filter((m) => m.to === user.email)).toHaveLength(0);
  });
});

describe("Cleanup of used recovery codes", () => {
  it("purges codes used more than 30 days ago and keeps recent and unused ones", async () => {
    const user = await createTestUser();
    const day = 86_400_000;
    const make = (usedAt: Date | null) =>
      prisma.recoveryCode.create({
        data: { userId: user.user.id, codeHash: hashRecoveryCode(randomUUID()), usedAt },
      });
    const old = await make(new Date(Date.now() - 31 * day));
    const recent = await make(new Date(Date.now() - 1 * day));
    const unused = await make(null);

    await cleanupExpiredSessions();

    expect(await prisma.recoveryCode.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.recoveryCode.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await prisma.recoveryCode.findUnique({ where: { id: unused.id } })).not.toBeNull();
  });
});
