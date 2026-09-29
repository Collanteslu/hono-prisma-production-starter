/**
 * @file openapi.ts
 * @description Helpers for declaring OpenAPI routes with @hono/zod-openapi.
 */

import { OpenAPIHono, type z } from "@hono/zod-openapi";
import { errorSchema } from "../schemas/responses.js";
import type { AppEnv } from "../types/index.js";
import { formatIssues } from "./validator.js";

/**
 * Creates a router whose request validation failures use the standard 400 error envelope.
 */
export const createRouter = () =>
  new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            success: false as const,
            message:
              result.target === "json"
                ? "Validation error in request payload"
                : `Invalid request ${result.target} parameters`,
            errors: formatIssues(result.error.issues),
          },
          400,
        );
      }
    },
  });

/** Marks a route as requiring a Bearer access token */
export const secured = [{ BearerAuth: [] }];

/** JSON response definition */
export const jsonResponse = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

/** Builds error response definitions from `{ status: description }` */
export function errorResponses<const T extends Record<number, string>>(defs: T) {
  return Object.fromEntries(
    Object.entries(defs).map(([status, description]) => [
      status,
      jsonResponse(errorSchema, description),
    ]),
  ) as { [K in keyof T]: ReturnType<typeof jsonResponse<typeof errorSchema>> };
}

/** JSON request body definition */
export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
