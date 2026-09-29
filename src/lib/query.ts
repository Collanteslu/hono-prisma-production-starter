/**
 * @file query.ts
 * @description Generic filtering, sorting, and pagination parser for Prisma queries.
 * Provides type-safe filtering with allowed fields, comparison operators, and directional sorting.
 */

export interface FilterOptions {
  allowedFields: string[];
}

export interface SortOptions {
  allowedFields: string[];
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
}

/**
 * Parses raw query parameters for filtering:
 * Supports:
 * - filter[field]=value (exact match or boolean conversion)
 * - filter[field][eq]=value
 * - filter[field][contains]=value
 * - filter[field][gte]=value
 * - filter[field][lte]=value
 * - filter[field][in]=val1,val2
 */
export function parseFilters(
  query: Record<string, string | undefined>,
  options: FilterOptions,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(query)) {
    if (!val) continue;

    // Pattern: filter[field] or filter[field][operator]
    const match = key.match(/^filter\[([a-zA-Z0-9_]+)\](?:\[([a-zA-Z0-9_]+)\])?$/);
    if (!match) continue;

    const [, field, operator] = match;
    if (!options.allowedFields.includes(field)) continue;

    if (!operator || operator === "eq") {
      if (val === "true") where[field] = true;
      else if (val === "false") where[field] = false;
      else where[field] = val;
    } else if (operator === "contains") {
      where[field] = { contains: val };
    } else if (operator === "gte") {
      where[field] = { gte: Number.isNaN(Number(val)) ? val : Number(val) };
    } else if (operator === "lte") {
      where[field] = { lte: Number.isNaN(Number(val)) ? val : Number(val) };
    } else if (operator === "in") {
      where[field] = { in: val.split(",").map((s) => s.trim()) };
    }
  }

  return where;
}

/**
 * Parses sort parameter, e.g. `sort=-createdAt,title`
 */
export function parseSorting(
  sortParam: string | undefined,
  options: SortOptions,
): Record<string, "asc" | "desc"> {
  const defaultSort = options.defaultSort || "createdAt";
  const defaultOrder = options.defaultOrder || "desc";

  if (!sortParam) {
    return { [defaultSort]: defaultOrder };
  }

  const orderBy: Record<string, "asc" | "desc"> = {};
  const parts = sortParam.split(",").map((p) => p.trim());

  for (const part of parts) {
    const isDesc = part.startsWith("-");
    const field = isDesc ? part.slice(1) : part;

    if (options.allowedFields.includes(field)) {
      orderBy[field] = isDesc ? "desc" : "asc";
    }
  }

  if (Object.keys(orderBy).length === 0) {
    return { [defaultSort]: defaultOrder };
  }

  return orderBy;
}
