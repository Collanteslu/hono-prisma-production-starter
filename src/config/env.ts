/**
 * @file env.ts
 * @description Environment variable loader and strict schema validator using Zod.
 * Ensures the application fails fast during startup if critical configurations are missing.
 */

import dotenv from "dotenv";
import { z } from "zod";

// Load variables from local .env file
dotenv.config();

/**
 * Strict schema validation for environment configuration.
 * Validates ports, execution modes, and enforces minimal cryptographic key lengths.
 */
const envSchema = z
  .object({
    PORT: z.coerce.number().default(3011),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    JWT_SECRET: z
      .string({ error: "JWT_SECRET is required (generate one with: openssl rand -base64 48)" })
      .min(16, "JWT_SECRET must contain at least 16 characters for cryptographic security"),
    JWT_REFRESH_SECRET: z
      .string({
        error: "JWT_REFRESH_SECRET is required (generate one with: openssl rand -base64 48)",
      })
      .min(16, "JWT_REFRESH_SECRET must contain at least 16 characters"),
    DATABASE_URL: z.string().default("file:./dev.db"),
    TURSO_DATABASE_URL: z.string().optional(),
    TURSO_AUTH_TOKEN: z.string().optional(),
    TRUST_PROXY: z
      .string()
      .optional()
      .transform((val) => val === "true" || val === "1"),
    // Number of trusted reverse proxies in front of the API (1 = one proxy such as Traefik/Nginx;
    // 2 = e.g. Cloudflare + Traefik). Only used when TRUST_PROXY is enabled.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().min(8).max(72).optional(),
    // Comma-separated list of allowed CORS origins ("*" allows any origin). When unset it defaults to
    // "*" outside production and to no cross-origin access at all in production.
    CORS_ORIGINS: z
      .string()
      .default(process.env.NODE_ENV === "production" ? "" : "*")
      .transform((val) =>
        val
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    // Expose /docs and /openapi.json (defaults to true outside production)
    ENABLE_DOCS: z
      .string()
      .optional()
      .transform((val) => (val === undefined ? undefined : val === "true" || val === "1")),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    // Per-IP limits for the recovery endpoints (per hour) and the MFA endpoints (per minute)
    RECOVERY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    MFA_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    // Failed passwords before an account is locked, and for how long
    LOGIN_LOCKOUT_MAX_FAILURES: z.coerce.number().int().positive().default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().positive().default(15),
    // Audit entries older than this many days are purged (0 keeps them forever)
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
    // --- Account recovery, email verification and two-factor authentication ---
    // "none" disables outgoing mail (default in production), "log" prints messages to the log
    // (default elsewhere, handy in development), "memory" keeps them in an array (tests only).
    MAIL_TRANSPORT: z
      .enum(["none", "log", "smtp", "memory"])
      .default(process.env.NODE_ENV === "production" ? "none" : "log"),
    SMTP_URL: z.string().optional(), // e.g. smtps://user:pass@smtp.example.com:465
    MAIL_FROM: z.string().default("Hono API <no-reply@localhost>"),
    // Frontend base URL used to build the links sent by email (token is appended as ?token=...)
    APP_URL: z.string().url().default("http://localhost:3000"),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().positive().default(60),
    EMAIL_VERIFY_TTL_HOURS: z.coerce.number().positive().default(24),
    // When true, accounts must verify their email before they can sign in
    REQUIRE_EMAIL_VERIFICATION: z
      .string()
      .optional()
      .transform((val) => val === "true" || val === "1"),
    // Key encrypting TOTP secrets at rest (defaults to a key derived from JWT_SECRET)
    MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
    MFA_ISSUER: z.string().default("Hono API"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    // Seconds during which reusing a just-rotated refresh token is treated as a concurrent refresh
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).default(10),
  })
  .superRefine((cfg, ctx) => {
    // Production hardening: refuse weak or shared signing secrets
    if (cfg.MAIL_TRANSPORT === "smtp" && !cfg.SMTP_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_URL"],
        message: "SMTP_URL is required when MAIL_TRANSPORT=smtp",
      });
    }
    if (
      cfg.REQUIRE_EMAIL_VERIFICATION &&
      (cfg.MAIL_TRANSPORT === "none" || cfg.MAIL_TRANSPORT === "log")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["REQUIRE_EMAIL_VERIFICATION"],
        message:
          "REQUIRE_EMAIL_VERIFICATION needs a mail transport that delivers (MAIL_TRANSPORT=smtp), otherwise nobody could verify",
      });
    }
    if (cfg.NODE_ENV !== "production") return;
    if (cfg.MAIL_TRANSPORT === "memory") {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_TRANSPORT"],
        message: "MAIL_TRANSPORT=memory is for tests only",
      });
    }
    for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET"] as const) {
      if (cfg[key].length < 32) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must contain at least 32 characters in production (generate one with: openssl rand -base64 48)`,
        });
      }
    }
    if (cfg.JWT_SECRET === cfg.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_REFRESH_SECRET must differ from JWT_SECRET in production",
      });
    }
  });

// Empty variables (e.g. `ADMIN_EMAIL=` from docker-compose defaults) are treated as undefined
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
);

const parsedEnv = envSchema.safeParse(rawEnv);

if (!parsedEnv.success) {
  console.error("❌ Critical startup failure: Invalid or missing environment configuration:");
  console.error(JSON.stringify(z.flattenError(parsedEnv.error).fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
