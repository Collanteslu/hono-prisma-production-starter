/**
 * @file logger.ts
 * @description Enterprise-grade structured logging using Pino.
 * Emits JSON logs in production for log aggregators (Datadog, Loki, CloudWatch)
 * and colorized human-readable logs in development mode.
 */

import pino from "pino";
import { env } from "../config/env.js";

const isProduction = env.NODE_ENV === "production";

export const logger = pino({
  level: env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  // Credentials must never reach the log aggregator even when a handler logs a whole object
  redact: {
    paths: [
      "password",
      "currentPassword",
      "newPassword",
      "token",
      "refreshToken",
      "accessToken",
      "authorization",
      "*.password",
      "*.currentPassword",
      "*.token",
      "*.refreshToken",
      "*.accessToken",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      },
});

export default logger;
