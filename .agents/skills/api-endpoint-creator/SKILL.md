---
name: api-endpoint-creator
description: >-
  Step-by-step standard procedure for designing, validating, and adding new REST API endpoints
  to this Hono project following clean modular architecture, Zod validation, and TypeScript strict typing.
---

# API Endpoint Creator Skill

Use this skill whenever adding new routes or domain entities to the API.

## Checklist for Adding a New Endpoint

1. **Define the Data Model**:
   - Add the Prisma model and create a migration (`npm run db:migrate -- --name add_<entity>` followed by `npm run db:generate`), see the `prisma-database-ops` skill. Prisma generates the entity types; `src/types/index.ts` only holds shared types (JWT payload, `AppEnv`, response metadata).
2. **Create Zod Schemas** (import `z` from `@hono/zod-openapi`):
   - Define strict input schemas in `src/schemas/index.ts` (name reusable ones with `.openapi("Name")`) for:
     - Request body (`create<Entity>Schema`, `update<Entity>Schema`).
     - Query parameters (`<entity>QuerySchema` with `page`, `limit`, `search`, `sortBy`, `order`, and optional `include`).
     - Route parameters (reuse `idParamSchema` or add a new one with `.openapi({ param: { name, in: "path" } })`).
   - Define the response schemas (`<entity>Schema`, wrapped with `successSchema(...)`) in `src/schemas/responses.ts`.
3. **Build the Route Module** (declare each route once with `createRoute`; it validates, types and documents):
   - Add response schemas to `src/schemas/responses.ts`, then create `src/routes/<entity>.ts`.
   - **Export the router as ONE chained expression** (`router.openapi(...).openapi(...)`): that is what makes `AppType` (Hono RPC client) carry the route types. Declare all `createRoute(...)` constants and helpers first, then chain the handlers:
     ```typescript
     import { createRoute, z } from '@hono/zod-openapi';
     import { prisma } from '../db.js';
     import { createRouter, errorResponses, jsonBody, jsonResponse, secured } from '../lib/openapi.js';
     import { parseIncludes } from '../lib/relations.js';
     import { buildPagination, successResponse } from '../lib/response.js';
     import { createEntitySchema, entityQuerySchema } from '../schemas/index.js';
     import { entitySchema, successSchema } from '../schemas/responses.js';

     const router = createRouter(); // request validation errors already use the 400 envelope

     // Whitelist allowed relations for eager loading / nesting
     const ALLOWED_INCLUDES = { items: true, user: true };

     const listRoute = createRoute({
       method: 'get',
       path: '/',
       tags: ['Entities'],
       summary: 'List entities',
       security: secured,
       request: { query: entityQuerySchema },
       responses: {
         200: jsonResponse(successSchema(z.array(entitySchema)), 'Paginated entities'),
         ...errorResponses({ 400: 'Invalid query', 401: 'Missing or invalid token' }),
       },
     });

     const createEntityRoute = createRoute({
       method: 'post',
       path: '/',
       tags: ['Entities'],
       security: secured,
       request: jsonBody(createEntitySchema),
       responses: {
         201: jsonResponse(successSchema(entitySchema), 'Created'),
         ...errorResponses({ 400: 'Validation error', 401: 'Missing or invalid token' }),
       },
     });

     export const entityRoutes = router
       .openapi(listRoute, async (c) => {
         const { page, limit } = c.req.valid('query');
         const include = parseIncludes(c.req.query('include'), ALLOWED_INCLUDES);
         const [total, items] = await Promise.all([
           prisma.entity.count(),
           prisma.entity.findMany({ include, skip: (page - 1) * limit, take: limit }),
         ]);
         return successResponse(c, items, { pagination: buildPagination(total, page, limit) });
       })
       .openapi(createEntityRoute, async (c) => {
         const data = c.req.valid('json'); // typed from the Zod schema
         const created = await prisma.entity.create({ data });
         return successResponse(c, created, { status: 201, message: 'Created successfully' });
       });
     ```
   - Return errors with `errorResponse(c, message, status)`; the compiler only accepts status codes declared in `responses`.
   - Admin-only routes: `middleware: [requireAdmin] as const` in `createRoute`. Owned resources: check `resource.userId === c.get('user').userId`. Record audit events with `recordAudit()`.
4. **Mount Route in `src/index.ts`**:
   - Add the prefix to the authentication list and chain the router into `routes` (keep `AppType = typeof routes`):
     ```typescript
     for (const prefix of ['/api/sessions', '/api/users', '/api/tasks', '/api/audit-logs', '/api/<entity>']) {
       app.use(prefix, authMiddleware);
       app.use(`${prefix}/*`, authMiddleware);
     }

     const routes = app
       .route('/api/auth', authRoutes)
       // ...existing routes
       .route('/api/<entity>', entityRoutes);
     ```
5. **Verify Compilation & Tests**:
   - Always run `npx @biomejs/biome check --write . && npm run typecheck && npm test`. Add tests for the happy path and the 400/401/403/404 paths; `tests/openapi.test.ts` fails automatically if the new route is missing from the spec.
6. **Update Docs & Bruno**:
   - No manual spec to edit: `/openapi.json` is generated from `createRoute`. `tests/openapi.test.ts` fails if a route is not documented.
   - Create and update the `.bru` request files in `bruno/<Entity>/` with example queries and documentation.

