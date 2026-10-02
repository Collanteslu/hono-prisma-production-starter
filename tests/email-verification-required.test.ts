import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REQUIRE_EMAIL_VERIFICATION is read once at startup, so this file loads the app with it enabled
type App = typeof import("../src/index.js")["default"];
let app: App;
let outbox: typeof import("../src/lib/mailer.js")["outbox"];

beforeAll(async () => {
  vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "true");
  vi.resetModules();
  app = (await import("../src/index.js")).default;
  outbox = (await import("../src/lib/mailer.js")).outbox;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const json = { "Content-Type": "application/json" };
const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: json, body: JSON.stringify(body) });

describe("REQUIRE_EMAIL_VERIFICATION=true", () => {
  it("blocks login until the email is verified, then lets the user in", async () => {
    const email = `strict-${randomUUID()}@example.com`;
    const reg = await post("/api/auth/register", {
      name: "Strict User",
      email,
      password: "password123",
    });
    expect(reg.status).toBe(201);

    const blocked = await post("/api/auth/login", { email, password: "password123" });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).details).toEqual({ code: "EMAIL_NOT_VERIFIED" });

    const mail = await vi.waitFor(
      () => {
        const found = outbox.find((m) => m.to === email);
        if (!found) throw new Error("no mail yet");
        return found;
      },
      { timeout: 3000, interval: 20 },
    );
    const token = /token=([\w-]+)/.exec(mail.text)?.[1];
    expect((await post("/api/auth/verify-email", { token })).status).toBe(200);

    expect((await post("/api/auth/login", { email, password: "password123" })).status).toBe(200);
  });

  it("does not let a wrong password learn whether the email is verified", async () => {
    const email = `strict-${randomUUID()}@example.com`;
    await post("/api/auth/register", { name: "Strict User", email, password: "password123" });
    const res = await post("/api/auth/login", { email, password: "wrong-password-1" });
    expect(res.status).toBe(401);
  });
});
