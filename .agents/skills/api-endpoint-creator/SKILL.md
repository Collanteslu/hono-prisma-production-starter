---
name: api-endpoint-creator
description: >-
  Step-by-step standard procedure for designing, validating, and adding new REST API endpoints
  to this Hono project following clean modular architecture, Zod validation, and TypeScript strict typing.
---

# API Endpoint Creator Skill

Use this skill whenever adding new routes or domain entities to the API.

## Checklist for Adding a New Endpoint

1. **Define Domain & Request/Response Types**:
   - Add model interfaces and context bindings in `src/types/index.ts`.
2. **Create Zod Validation Schemas**:
   - Define strict input schemas in `src/schemas/index.ts` for:
     - Request body (`create<Entity>Schema`, `update<Entity>Schema`).
     - Query parameters (`<entity>QuerySchema` with `page`, `limit`, `search`, `sortBy`, `order`, and optional `include`).
     - Route parameters (`<entity>ParamsSchema` if UUID or specific format validation is needed).
3. **Build Modular Route Handler** (declare once with `createRoute`; it validates, types and documents):
   - Add response schemas to `src/schemas/responses.ts`, then create `src/routes/<entity>.ts`:
     ```typescript
     import { createRoute, z } from '@hono/zod-openapi';
     import { prisma } from '../db.js';
     import { createRouter, errorResponses, jsonBody, jsonResponse, secured } from '../lib/openapi.js';
     import { parseIncludes } from '../lib/relations.js';
     import { buildPagination, successResponse } from '../lib/response.js';
     import { createEntitySchema, entityQuerySchema } from '../schemas/index.js';
     import { entitySchema, successSchema } from '../schemas/responses.js';

     export const entityRoutes = createRouter();

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

     entityRoutes.openapi(listRoute, async (c) => {
       const { page, limit } = c.req.valid('query');
       const include = parseIncludes(c.req.query('include'), ALLOWED_INCLUDES);
       const [total, items] = await Promise.all([
         prisma.entity.count(),
         prisma.entity.findMany({ include, skip: (page - 1) * limit, take: limit }),
       ]);
       return successResponse(c, items, { pagination: buildPagination(total, page, limit) });
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

     entityRoutes.openapi(createEntityRoute, async (c) => {
       const data = c.req.valid('json'); // typed from the Zod schema; 400s are handled by createRouter()
       const created = await prisma.entity.create({ data });
       return successResponse(c, created, { status: 201, message: 'Created successfully' });
     });
     ```
4. **Mount Route in `src/index.ts`**:
   - Apply `authMiddleware` if the route requires authentication:
     ```typescript
     for (const prefix of ['/api/<entity>']) {
       app.use(prefix, authMiddleware);
       app.use(`${prefix}/*`, authMiddleware);
     }
     app.route('/api/<entity>', entityRoutes);
     ```
5. **Verify Compilation & Tests**:
   - Always run `npx @biomejs/biome check --write . && npm run build && npm test` to ensure zero lint or type errors and 100% test coverage.
6. **Update Docs & Bruno**:
   - No manual spec to edit: `/openapi.json` is generated from `createRoute`. `tests/openapi.test.ts` fails if a route is not documented.
   - Create and update the `.bru` request files in `bruno/<Entity>/` with example queries and documentation.

