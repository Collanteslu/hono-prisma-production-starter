---
name: openapi-documentation
description: >-
  Standard operating procedure for documenting endpoints, updating schemas,
  and maintaining the interactive Scalar OpenAPI console in this project.
---

# OpenAPI Documentation Skill

Use this skill whenever adding or modifying endpoints to keep the interactive web documentation at `/docs` in sync.

## Documentation Workflow

The OpenAPI specification is centrally maintained in `src/docs/openapi.ts` and served at:
- Raw JSON: `GET /openapi.json`
- Interactive Console: `GET /docs` (powered by `@scalar/hono-api-reference`)

### 1. Documenting a New Route in `src/docs/openapi.ts`

Add an entry under `openApiSpec.paths`:

```typescript
'/api/example': {
  get: {
    summary: 'Brief description of endpoint action',
    description: 'Detailed explanation of behavior, filtering, and side-effects.',
    security: [{ BearerAuth: [] }], // Include if protected by JWT
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
      { name: 'search', in: 'query', schema: { type: 'string' } }
    ],
    responses: {
      '200': {
        description: 'Successful operation',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                pagination: { $ref: '#/components/schemas/PaginationMeta' },
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ExampleModel' }
                }
              }
            }
          }
        }
      },
      '401': { description: 'Missing or expired Bearer token' },
      '403': { description: 'Access forbidden (e.g. suspended user or unowned resource)' }
    }
  }
}
```

### 2. Documenting Reusable Schemas

Add the entity schema under `openApiSpec.components.schemas`:

```typescript
components: {
  schemas: {
    ExampleModel: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'Example Name' },
        createdAt: { type: 'string', format: 'date-time' }
      }
    }
  }
}
```

### 3. Verification
1. Start development server: `npm run dev`.
2. Open `http://localhost:3011/docs` in the browser.
3. Test the interactive runner: Use **Authorize** with a fresh JWT to execute live queries.
