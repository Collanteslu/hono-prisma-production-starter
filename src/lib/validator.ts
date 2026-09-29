/**
 * @file validator.ts
 * @description Helpers to render Zod validation issues in the standard error envelope.
 */

/** Groups Zod issues by field path: `{ "email": ["Invalid email"], "password": [...] }` */
export function formatIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".") || "_root";
    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message);
  }
  return errors;
}
