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
const envSchema = z.object({
  PORT: z.coerce.number().default(3011),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  JWT_SECRET: z
    .string()
    .min(16, "JWT_SECRET must contain at least 16 characters for cryptographic security"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must contain at least 16 characters"),
  DATABASE_URL: z.string().default("file:./dev.db"),
  TURSO_DATABASE_URL: z.string().optional(),
  TURSO_AUTH_TOKEN: z.string().optional(),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Critical startup failure: Invalid or missing environment configuration:");
  console.error(JSON.stringify(parsedEnv.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
