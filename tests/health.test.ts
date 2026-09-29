import { describe, expect, it } from "vitest";
import app from "../src/index.js";

describe("Health & Diagnostics API", () => {
  it("GET /healthz should return 200 with database health and uptime", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("healthy");
    expect(data.database.status).toBe("connected");
    expect(data.database.latencyMs).toBeTypeOf("number");
    expect(data.uptimeSeconds).toBeTypeOf("number");
  });

  it("GET /docs should serve the Scalar OpenAPI documentation page", async () => {
    const res = await app.request("/docs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Scalar");
  });

  it("POST /api/auth/login with excessive payload (>100KB) should return 413 Payload Too Large", async () => {
    const largeString = "a".repeat(105 * 1024);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: largeString }),
    });

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Payload Too Large");
  });

  it("responses include HTTP security headers and tracing/timing headers", async () => {
    const res = await app.request("/healthz");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBeTruthy();
    expect(res.headers.get("Strict-Transport-Security")).toBeTruthy();
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(res.headers.get("X-Response-Time")).toMatch(/ms$/);
    expect(res.headers.get("Server-Timing")).toMatch(/^total;dur=/);
  });
});
