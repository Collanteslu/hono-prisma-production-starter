import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { outbox } from "../src/lib/mailer.js";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  totpCode,
  verifyTotp,
} from "../src/lib/totp.js";
import { app, bearer, createTestUser, jsonHeaders, login, loginAdmin } from "./helpers.js";

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: "POST",
    headers: token ? bearer(token) : jsonHeaders,
    body: JSON.stringify(body),
  });

/** Waits for the (background) email addressed to `to` and returns the token in its link */
async function tokenEmailedTo(to: string, sinceIndex = 0): Promise<string> {
  const message = await vi.waitFor(
    () => {
      const found = outbox.slice(sinceIndex).find((m) => m.to === to);
      if (!found) throw new Error(`no mail for ${to} yet`);
      return found;
    },
    { timeout: 3000, interval: 20 },
  );
  const token = /token=([\w-]+)/.exec(message.text)?.[1];
  if (!token) throw new Error("no token in mail");
  return token;
}

/** Gives background work time to run, to assert that nothing was sent */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("TOTP primitives", () => {
  // RFC 6238 appendix B (SHA-1), last 6 digits of the published 8-digit codes
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC 6238 test vectors", () => {
    expect(totpCode(rfcSecret, 59_000)).toBe("287082");
    expect(totpCode(rfcSecret, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(rfcSecret, 2_000_000_000_000)).toBe("279037");
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from([1, 2, 3, 250, 251, 252, 0, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("accepts ±1 step of drift, rejects older codes and replays", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(rfcSecret, now);
    const step = verifyTotp(rfcSecret, code, null, now);
    expect(step).not.toBeNull();
    expect(verifyTotp(rfcSecret, code, null, now + 30_000)).toBe(step); // still inside the window
    expect(verifyTotp(rfcSecret, code, null, now + 90_000)).toBeNull(); // too old
    expect(verifyTotp(rfcSecret, code, step, now)).toBeNull(); // replay
    expect(verifyTotp(rfcSecret, "12345", null, now)).toBeNull();
    expect(verifyTotp(rfcSecret, "abcdef", null, now)).toBeNull();
  });

  it("encrypts secrets at rest and detects tampering", () => {
    const encrypted = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP");
    const parts = encrypted.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

describe("Password recovery", () => {
  it("answers 202 for unknown and known emails alike, and only mails real accounts", async () => {
    const user = await createTestUser();
    const before = outbox.length;

    const unknown = await post("/api/auth/forgot-password", {
      email: `nobody-${randomUUID()}@example.com`,
    });
    const known = await post("/api/auth/forgot-password", { email: user.email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect((await unknown.json()).message).toBe((await known.json()).message);

    await tokenEmailedTo(user.email, before);
    await settle();
    expect(outbox.slice(before).filter((m) => m.subject.includes("Reset"))).toHaveLength(1);
  });

  it("resets the password once, revokes every session and unlocks the account", async () => {
    const user = await createTestUser();
    const before = outbox.length;
    await post("/api/auth/forgot-password", { email: user.email });
    const token = await tokenEmailedTo(user.email, before);

    // Lock the account first, to prove the reset lifts the lockout
    for (let i = 0; i < 5; i++)
      await post("/api/auth/login", { email: user.email, password: "wrong-pass-1" });
    const locked = await post("/api/auth/login", { email: user.email, password: user.password });
    expect(locked.status).toBe(429);

    const reset = await post("/api/auth/reset-password", { token, password: "brand-new-pass-1" });
    expect(reset.status).toBe(200);

    const oldSession = await app.request("/api/sessions/me", { headers: bearer(user.accessToken) });
    expect(oldSession.status).toBe(401);
    await expect(login(user.email, "brand-new-pass-1")).resolves.toBeDefined();

    const again = await post("/api/auth/reset-password", { token, password: "another-pass-22" });
    expect(again.status).toBe(400);
  });

  it("rejects garbage, expired and wrong-type tokens", async () => {
    const user = await createTestUser();
    const before = outbox.length;
    await post("/api/auth/forgot-password", { email: user.email });
    const token = await tokenEmailedTo(user.email, before);

    expect(
      (
        await post("/api/auth/reset-password", {
          token: "x".repeat(43),
          password: "brand-new-pass-1",
        })
      ).status,
    ).toBe(400);

    // An email-verification token must not reset a password
    await prisma.user.update({ where: { id: user.user.id }, data: { emailVerifiedAt: null } });
    const mark = outbox.length;
    await post("/api/auth/resend-verification", { email: user.email });
    const verifyToken = await tokenEmailedTo(user.email, mark);
    expect(
      (await post("/api/auth/reset-password", { token: verifyToken, password: "brand-new-pass-1" }))
        .status,
    ).toBe(400);

    await prisma.authToken.updateMany({
      where: { userId: user.user.id, type: "password_reset" },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (await post("/api/auth/reset-password", { token, password: "brand-new-pass-1" })).status,
    ).toBe(400);
  });

  it("applies the password policy to the new password and keeps the token usable", async () => {
    const user = await createTestUser();
    const before = outbox.length;
    await post("/api/auth/forgot-password", { email: user.email });
    const token = await tokenEmailedTo(user.email, before);

    const weak = await post("/api/auth/reset-password", { token, password: "short" });
    expect(weak.status).toBe(400);
    expect((await weak.json()).errors).toBeDefined();
    expect(
      (await post("/api/auth/reset-password", { token, password: "long-enough-pass" })).status,
    ).toBe(200);
  });

  it("throttles emails per address (no inbox flooding)", async () => {
    const user = await createTestUser();
    const before = outbox.length;
    for (let i = 0; i < 5; i++) await post("/api/auth/forgot-password", { email: user.email });
    await settle();
    await settle();
    expect(outbox.slice(before).filter((m) => m.to === user.email)).toHaveLength(3);
  });

  it("does not send reset emails to suspended accounts", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.user.id }, data: { isBlocked: true } });
    const before = outbox.length;
    expect((await post("/api/auth/forgot-password", { email: user.email })).status).toBe(202);
    await settle();
    expect(outbox.slice(before).filter((m) => m.to === user.email)).toHaveLength(0);
  });
});

describe("Email verification", () => {
  it("sends a link on registration, verifies once, and stops resending when verified", async () => {
    const email = `verify-${randomUUID()}@example.com`;
    const before = outbox.length;
    await post("/api/auth/register", { name: "Verify Me", email, password: "password123" });
    const token = await tokenEmailedTo(email, before);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.emailVerifiedAt).toBeNull();

    expect((await post("/api/auth/verify-email", { token })).status).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt,
    ).not.toBeNull();
    expect((await post("/api/auth/verify-email", { token })).status).toBe(400);

    const mark = outbox.length;
    expect((await post("/api/auth/resend-verification", { email })).status).toBe(202);
    await settle();
    expect(outbox.slice(mark)).toHaveLength(0);
  });

  it("changing your email needs the current password and re-opens verification", async () => {
    const user = await createTestUser();
    await prisma.user.update({
      where: { id: user.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    const newEmail = `moved-${randomUUID()}@example.com`;
    const put = (body: unknown) =>
      app.request(`/api/users/${user.user.id}`, {
        method: "PUT",
        headers: bearer(user.accessToken),
        body: JSON.stringify(body),
      });

    expect((await put({ email: newEmail })).status).toBe(403);
    expect((await put({ email: newEmail, currentPassword: "nope-nope-1" })).status).toBe(403);

    const before = outbox.length;
    expect((await put({ email: newEmail, currentPassword: user.password })).status).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.user.id } })).emailVerifiedAt,
    ).toBeNull();
    await tokenEmailedTo(newEmail, before);

    // Changing the name needs nothing extra
    expect((await put({ name: "Renamed User" })).status).toBe(200);
  });
});

describe("Two-factor authentication", () => {
  async function enroll() {
    const user = await createTestUser();
    const setup = await post(
      "/api/auth/mfa/setup",
      { currentPassword: user.password },
      user.accessToken,
    );
    const { secret } = (await setup.json()).data as { secret: string; otpauthUrl: string };
    // Use the next time step so the login codes below still fall after it
    const enable = await post("/api/auth/mfa/enable", { code: totpCode(secret) }, user.accessToken);
    const { recoveryCodes } = (await enable.json()).data as { recoveryCodes: string[] };
    return { user, secret, recoveryCodes, enableStatus: enable.status };
  }

  const loginWith = (email: string, extra: Record<string, string> = {}) =>
    post("/api/auth/login", { email, password: "password123", ...extra });

  it("requires the password to start, the first code to confirm, and revokes other devices", async () => {
    const user = await createTestUser();
    const otherDevice = await login(user.email, user.password);

    const wrongPw = await post(
      "/api/auth/mfa/setup",
      { currentPassword: "wrong-pass-9" },
      user.accessToken,
    );
    expect(wrongPw.status).toBe(403);

    const setup = await post(
      "/api/auth/mfa/setup",
      { currentPassword: user.password },
      user.accessToken,
    );
    expect(setup.status).toBe(200);
    const { secret, otpauthUrl } = (await setup.json()).data;
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=/);

    // Stored encrypted, never in clear
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.user.id },
      omit: { totpSecret: false },
    });
    expect(row.totpSecret).toBeTruthy();
    expect(row.totpSecret).not.toContain(secret);
    expect(decryptSecret(row.totpSecret as string)).toBe(secret);

    const bad = await post("/api/auth/mfa/enable", { code: "000000" }, user.accessToken);
    expect(bad.status).toBe(400);

    const enable = await post("/api/auth/mfa/enable", { code: totpCode(secret) }, user.accessToken);
    expect(enable.status).toBe(200);
    expect(((await enable.json()).data.recoveryCodes as string[]).length).toBe(10);

    const current = await app.request("/api/sessions/me", { headers: bearer(user.accessToken) });
    expect(current.status).toBe(200);
    const other = await app.request("/api/sessions/me", {
      headers: bearer(otherDevice.accessToken),
    });
    expect(other.status).toBe(401);

    const again = await post(
      "/api/auth/mfa/setup",
      { currentPassword: user.password },
      user.accessToken,
    );
    expect(again.status).toBe(409);
  });

  it("login needs the second factor, rejects replays and bad codes, accepts recovery codes once", async () => {
    const { user, secret, recoveryCodes, enableStatus } = await enroll();
    expect(enableStatus).toBe(200);

    const missing = await loginWith(user.email);
    expect(missing.status).toBe(401);
    expect((await missing.json()).details).toEqual({ code: "MFA_REQUIRED" });

    // The enable step already consumed the current time step: the same code is a replay
    const replay = await loginWith(user.email, { totpCode: totpCode(secret) });
    expect(replay.status).toBe(401);
    expect((await replay.json()).details).toEqual({ code: "MFA_INVALID" });

    // The next step is accepted (±1 step of clock drift) and then can't be reused
    const nextCode = totpCode(secret, Date.now() + 30_000);
    const ok = await loginWith(user.email, { totpCode: nextCode });
    expect(ok.status).toBe(200);
    expect((await loginWith(user.email, { totpCode: nextCode })).status).toBe(401);

    const recovery = await loginWith(user.email, { recoveryCode: recoveryCodes[0] });
    expect(recovery.status).toBe(200);
    expect((await loginWith(user.email, { recoveryCode: recoveryCodes[0] })).status).toBe(401);
  });

  it("wrong codes count towards the account lockout, a missing one does not", async () => {
    const { user } = await enroll();
    for (let i = 0; i < 6; i++) expect((await loginWith(user.email)).status).toBe(401);
    for (let i = 0; i < 5; i++) {
      expect((await loginWith(user.email, { totpCode: "123456" })).status).toBe(401);
    }
    expect((await loginWith(user.email, { totpCode: "123456" })).status).toBe(429);
  });

  it("is never exposed through the users API", async () => {
    const { user } = await enroll();
    const admin = await loginAdmin();
    const res = await app.request(`/api/users/${user.user.id}`, {
      headers: bearer(admin.accessToken),
    });
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("totpSecret");
    expect(body).not.toContain("totpLastStep");
    expect(body).toContain("totpEnabledAt");
  });

  it("can be disabled with the password plus a code or recovery code", async () => {
    const { user, recoveryCodes } = await enroll();
    const session = await login(user.email, user.password, { recoveryCode: recoveryCodes[1] });

    const noFactor = await post(
      "/api/auth/mfa/disable",
      { currentPassword: user.password },
      session.accessToken,
    );
    expect(noFactor.status).toBe(400);
    const badPw = await post(
      "/api/auth/mfa/disable",
      { currentPassword: "wrong-pass-9", recoveryCode: recoveryCodes[2] },
      session.accessToken,
    );
    expect(badPw.status).toBe(403);
    const ok = await post(
      "/api/auth/mfa/disable",
      { currentPassword: user.password, recoveryCode: recoveryCodes[2] },
      session.accessToken,
    );
    expect(ok.status).toBe(200);

    expect((await loginWith(user.email)).status).toBe(200);
    expect(await prisma.recoveryCode.count({ where: { userId: user.user.id } })).toBe(0);
  });

  it("lets an admin reset a user who lost their device, and nobody else", async () => {
    const { user } = await enroll();
    const stranger = await createTestUser();
    const forbidden = await app.request(`/api/users/${user.user.id}/mfa`, {
      method: "DELETE",
      headers: bearer(stranger.accessToken),
    });
    expect(forbidden.status).toBe(403);

    const admin = await loginAdmin();
    const reset = await app.request(`/api/users/${user.user.id}/mfa`, {
      method: "DELETE",
      headers: bearer(admin.accessToken),
    });
    expect(reset.status).toBe(200);
    expect((await loginWith(user.email)).status).toBe(200);

    const again = await app.request(`/api/users/${user.user.id}/mfa`, {
      method: "DELETE",
      headers: bearer(admin.accessToken),
    });
    expect(again.status).toBe(409);
  });
});

describe("Admin view of tasks", () => {
  const createTask = async (token: string, title: string) => {
    const res = await post("/api/tasks", { title }, token);
    return (await res.json()).data as { id: string };
  };

  it("lets admins list one user's or everyone's tasks and read any task, but not write", async () => {
    const owner = await createTestUser();
    const task = await createTask(owner.accessToken, "Owner task here");
    const admin = await loginAdmin();

    const byUser = await app.request(`/api/tasks?userId=${owner.user.id}`, {
      headers: bearer(admin.accessToken),
    });
    expect(byUser.status).toBe(200);
    const listed = (await byUser.json()).data as { id: string }[];
    expect(listed.map((t) => t.id)).toContain(task.id);

    const all = await app.request("/api/tasks?scope=all&limit=100", {
      headers: bearer(admin.accessToken),
    });
    expect(all.status).toBe(200);
    expect(
      ((await all.json()).data as { userId: string }[]).some((t) => t.userId === owner.user.id),
    ).toBe(true);

    expect(
      (await app.request(`/api/tasks/${task.id}`, { headers: bearer(admin.accessToken) })).status,
    ).toBe(200);
    const write = await app.request(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: bearer(admin.accessToken),
      body: JSON.stringify({ title: "Hijacked by admin" }),
    });
    expect(write.status).toBe(404);
  });

  it("keeps regular users to their own tasks and refuses the admin-only filters", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    await createTask(other.accessToken, "Not yours at all");

    const own = await app.request("/api/tasks", { headers: bearer(user.accessToken) });
    expect(((await own.json()).data as unknown[]).length).toBe(0);
    expect(
      (
        await app.request(`/api/tasks?userId=${other.user.id}`, {
          headers: bearer(user.accessToken),
        })
      ).status,
    ).toBe(403);
    expect(
      (await app.request("/api/tasks?scope=all", { headers: bearer(user.accessToken) })).status,
    ).toBe(403);
  });
});

describe("Messages are in English", () => {
  it("returns English validation messages", async () => {
    const res = await post("/api/auth/register", {
      name: "A",
      email: "not-an-email",
      password: "123",
    });
    expect(res.status).toBe(400);
    const text = JSON.stringify((await res.json()).errors);
    expect(text).toContain("Password must be at least 8 characters long");
    expect(text).toContain("Invalid email format");
    expect(text).not.toMatch(/contraseña|debe tener/i);
  });
});

describe("Emailed tokens after an email or password change", () => {
  const putUser = (user: { user: { id: string }; accessToken: string }, body: unknown) =>
    app.request(`/api/users/${user.user.id}`, {
      method: "PUT",
      headers: bearer(user.accessToken),
      body: JSON.stringify(body),
    });

  it("a reset link sent to the old address stops working once the email changes", async () => {
    const user = await createTestUser();
    const before = outbox.length;
    await post("/api/auth/forgot-password", { email: user.email });
    const token = await tokenEmailedTo(user.email, before);

    const newEmail = `moved-${randomUUID()}@example.com`;
    const mark = outbox.length;
    expect((await putUser(user, { email: newEmail, currentPassword: user.password })).status).toBe(
      200,
    );
    await tokenEmailedTo(newEmail, mark);

    const reset = await post("/api/auth/reset-password", { token, password: "brand-new-pass-1" });
    expect(reset.status).toBe(400);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.user.id } });
    // The new, never confirmed address must not end up verified, and the password is unchanged
    expect(stored.emailVerifiedAt).toBeNull();
    await expect(login(newEmail, user.password)).resolves.toBeDefined();
  });

  it("a verification link sent to the old address cannot verify the new one", async () => {
    const before = outbox.length;
    const user = await createTestUser();
    const oldToken = await tokenEmailedTo(user.email, before);

    const newEmail = `moved-${randomUUID()}@example.com`;
    const mark = outbox.length;
    expect((await putUser(user, { email: newEmail, currentPassword: user.password })).status).toBe(
      200,
    );
    const newToken = await tokenEmailedTo(newEmail, mark);

    expect((await post("/api/auth/verify-email", { token: oldToken })).status).toBe(400);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.user.id } })).emailVerifiedAt,
    ).toBeNull();

    // The link sent to the new address does work
    expect((await post("/api/auth/verify-email", { token: newToken })).status).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.user.id } })).emailVerifiedAt,
    ).not.toBeNull();
  });

  it("changing the password deletes every pending reset and verification link", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.user.id }, data: { emailVerifiedAt: null } });
    const before = outbox.length;
    await post("/api/auth/forgot-password", { email: user.email });
    const resetToken = await tokenEmailedTo(user.email, before);
    const mark = outbox.length;
    await post("/api/auth/resend-verification", { email: user.email });
    const verifyToken = await tokenEmailedTo(user.email, mark);

    expect(
      (await putUser(user, { password: "changed-pass-123", currentPassword: user.password }))
        .status,
    ).toBe(200);

    expect(await prisma.authToken.count({ where: { userId: user.user.id, usedAt: null } })).toBe(0);
    expect(
      (await post("/api/auth/reset-password", { token: resetToken, password: "brand-new-pass-1" }))
        .status,
    ).toBe(400);
    expect((await post("/api/auth/verify-email", { token: verifyToken })).status).toBe(400);
    await expect(login(user.email, "changed-pass-123")).resolves.toBeDefined();
  });

  it("an admin changing someone's email or password also deletes their pending links", async () => {
    const admin = await loginAdmin();
    const user = await createTestUser();
    const before = outbox.length;
    await post("/api/auth/forgot-password", { email: user.email });
    const token = await tokenEmailedTo(user.email, before);

    const res = await app.request(`/api/users/${user.user.id}`, {
      method: "PUT",
      headers: bearer(admin.accessToken),
      body: JSON.stringify({ email: `admin-moved-${randomUUID()}@example.com` }),
    });
    expect(res.status).toBe(200);
    expect(
      (await post("/api/auth/reset-password", { token, password: "brand-new-pass-1" })).status,
    ).toBe(400);
  });

  it("a token issued to an address the account no longer has is rejected", async () => {
    // Simulates a link created in the background just before (or racing with) an email change
    const user = await createTestUser();
    const before = outbox.length;
    await post("/api/auth/forgot-password", { email: user.email });
    const token = await tokenEmailedTo(user.email, before);
    await prisma.user.update({
      where: { id: user.user.id },
      data: { email: `raced-${randomUUID()}@example.com` },
    });

    expect(
      (await post("/api/auth/reset-password", { token, password: "brand-new-pass-1" })).status,
    ).toBe(400);
  });
});
