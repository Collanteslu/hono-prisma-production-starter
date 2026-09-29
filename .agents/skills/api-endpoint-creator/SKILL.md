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
3. **Build Modular Route Handler**:
   - Create route file in `src/routes/<entity>.ts`:
     ```typescript
     import { Hono } from 'hono';
     import { zValidator } from '@hono/zod-validator';
     import { prisma } from '../db.js';
     import { AppEnv } from '../types/index.js';
     import { createEntitySchema } from '../schemas/index.js';
     import { parseIncludes } from '../lib/relations.js';
     import { successResponse, paginationResponse } from '../lib/response.js';

     export const entityRoutes = new Hono<AppEnv>();

     // Whitelist allowed relations for eager loading / nesting
     const ALLOWED_INCLUDES = {
       items: true,
       user: true,
     };

     entityRoutes.get('/', async (c) => {
       const includes = parseIncludes(c.req.query('include'), ALLOWED_INCLUDES);
       const items = await prisma.entity.findMany({
         include: includes,
       });
       return c.json(successResponse(c, items));
     });

     entityRoutes.post(
       '/',
       zValidator('json', createEntitySchema, (result, c) => {
         if (!result.success) {
           return c.json({
             success: false,
             message: 'Validation error',
             errors: result.error.flatten().fieldErrors
           }, 400);
         }
       }),
       async (c) => {
         const data = c.req.valid('json');
         const currentUser = c.get('user');
         const created = await prisma.entity.create({ data });
         return c.json(successResponse(c, created, 'Created successfully'), 201);
       }
     );
     ```
4. **Mount Route in `src/index.ts`**:
   - Apply `authMiddleware` if the route requires authentication:
     ```typescript
     app.use('/api/<entity>/*', authMiddleware);
     app.route('/api/<entity>', entityRoutes);
     ```
5. **Verify Compilation & Tests**:
   - Always run `npx @biomejs/biome check --write . && npm run build && npm test` to ensure zero lint or type errors and 100% test coverage.
6. **Update Docs & Bruno**:
   - Add endpoint to `src/docs/openapi.ts` (including `include` query params and `ResponseMeta` schema).
   - Create and update the `.bru` request files in `bruno/<Entity>/` with example queries and documentation.

