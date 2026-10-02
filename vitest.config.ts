import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Every test run uses its own throwaway SQLite database (never the developer's dev.db)
const testDatabaseUrl = `file:${path.join(tmpdir(), `hono-api-test-${process.pid}-${Date.now()}.db`)}`;
process.env.TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    testTimeout: 15000,
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      TURSO_DATABASE_URL: "",
      JWT_SECRET: "test_jwt_secret_key_at_least_32_characters_long",
      JWT_REFRESH_SECRET: "test_jwt_refresh_secret_key_at_least_32_characters",
      TRUST_PROXY: "false",
      LOG_LEVEL: "silent",
      MAIL_TRANSPORT: "memory",
      RECOVERY_RATE_LIMIT_MAX: "1000",
      MFA_RATE_LIMIT_MAX: "1000",
      LOGIN_RATE_LIMIT_MAX: "1000",
      REFRESH_RATE_LIMIT_MAX: "1000",
      REGISTER_RATE_LIMIT_MAX: "1000",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/docs/**"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
