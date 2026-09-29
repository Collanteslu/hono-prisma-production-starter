---
name: openapi-documentation
description: >-
  Standard operating procedure for documenting endpoints and maintaining the
  auto-generated OpenAPI spec and interactive Scalar console in this project.
---

# OpenAPI Documentation Skill

The OpenAPI 3.0 specification is **generated at runtime** from the route definitions and Zod
schemas (`@hono/zod-openapi`). There is no hand-written spec file: if the route exists and its
schemas are right, the documentation is right.

- Raw JSON: `GET /openapi.json`
- Interactive console: `GET /docs` (`@scalar/hono-api-reference`)
- Both are disabled in production unless `ENABLE_DOCS=true`.

## Documenting a route

Every route is declared once with `createRoute` and implemented with `router.openapi(route, handler)`.
The same definition validates the request, types the handler and documents the endpoint:

```typescript
import { createRoute, z } from "@hono/zod-openapi";
import { createRouter, errorResponses, jsonResponse, secured } from "../lib/openapi.js";
import { successSchema, taskSchema } from "../schemas/responses.js";

const listRoute = createRoute({
  method: "get",
  path: "/",                       // use "/{id}" for path params, not ":id"
  tags: ["Tasks"],
  summary: "Short action description",
  description: "Behavior, filtering and side effects.",
  security: secured,                // protected routes only
  middleware: [requireAdmin] as const, // optional route-level middleware
  request: { query: taskQuerySchema },   // also: params, body via jsonBody(schema)
  responses: {
    200: jsonResponse(successSchema(z.array(taskSchema)), "Paginated tasks"),
    ...errorResponses({ 400: "Invalid query", 401: "Missing or invalid token" }),
  },
});

router.openapi(listRoute, async (c) => {
  const query = c.req.valid("query"); // fully typed from the Zod schema
  return successResponse(c, tasks);   // return type is checked against `responses`
});
```

The compiler rejects handlers that return a status code or body shape that is not declared in
`responses`, so code and documentation cannot silently diverge.

## Schemas

- **Request schemas** live in `src/schemas/index.ts`; **response schemas** in `src/schemas/responses.ts`.
- Import `z` from `@hono/zod-openapi` (not `zod`) in those files so `.openapi()` is available.
- Name reusable schemas with `.openapi("Name")` to publish them under `components.schemas`.
- Add `.openapi({ example, description })` to fields when it helps API consumers.
- Path params need `.openapi({ param: { name, in: "path" } })` (see `idParamSchema`).

## Verification

1. `npm test` — `tests/openapi.test.ts` validates the spec, fails if any registered `/api` route is
   missing from it, and checks that real responses satisfy the published schemas.
2. `npm run dev` and open `http://localhost:3011/docs`; use **Authorize** with a fresh JWT.
