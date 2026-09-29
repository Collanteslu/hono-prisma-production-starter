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
});
