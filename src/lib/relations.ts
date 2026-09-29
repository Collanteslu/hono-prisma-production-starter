/**
 * @file relations.ts
 * @description Dynamic relational expansion parser for Hono + Prisma.
 * Parses comma-separated query parameters (e.g. ?include=tasks,sessions or ?include=user)
 * against an allowed whitelist to safely build Prisma `include` clauses dynamically.
 */

/**
 * Parses an optional include query string against a dictionary of allowed relations.
 *
 * @example
 * // In route handler:
 * const include = parseIncludes(c.req.query("include"), {
 *   tasks: true,
 *   sessions: true,
 *   user: { select: { id: true, name: true, email: true } },
 * });
 * const data = await prisma.user.findMany({ where, include });
 */
export function parseIncludes<T extends Record<string, unknown>>(
  includeParam: string | undefined,
  allowedMap: T,
): Partial<T> | undefined {
  if (!includeParam || typeof includeParam !== "string") {
    return undefined;
  }

  const requested = includeParam
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (requested.length === 0) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  let hasValidRelation = false;

  for (const rel of requested) {
    if (Object.hasOwn(allowedMap, rel)) {
      result[rel] = allowedMap[rel];
      hasValidRelation = true;
    }
  }

  return hasValidRelation ? (result as Partial<T>) : undefined;
}
