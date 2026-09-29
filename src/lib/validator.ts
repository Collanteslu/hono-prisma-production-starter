/**
 * @file validator.ts
 * @description Zod request validator returning the standard 400 error envelope on failure.
 */

import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodSchema } from "zod";

export const validate = <T extends ZodSchema, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
  message = "Validation error in request payload",
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const { fieldErrors, formErrors } = result.error.flatten();
      return c.json(
        {
          success: false,
          message,
          errors: fieldErrors,
          ...(formErrors.length > 0 && { formErrors }),
        },
        400,
      );
    }
  });
