---
name: bruno-testing
description: >-
  Guide and best practices for creating, structuring, and maintaining
  offline-first API test collections using Bruno API Client in this project.
---

# Bruno API Client Testing Skill

Use this skill whenever adding new endpoints, modifying request formats, or designing automated collection tests.

## Why Bruno in this Project?
Bruno stores API requests in Git as plain-text `.bru` files inside `bruno/`.
- **Zero Cloud Leak**: Secrets and tokens remain local.
- **Git Versioned**: Changes to API contracts are reviewed in PRs alongside code changes.

> **Never commit tokens or secrets.** `bruno/environments/Local.bru` must only contain `baseUrl`. Tokens are stored as Bruno *runtime* variables with `bru.setVar(...)` (in memory, never written to disk). Do **not** use `bru.setEnvVar(...)`: depending on the Bruno version it can persist the value into the tracked environment file.

## Directory Structure
```text
bruno/
├── bruno.json                    # Collection metadata
├── collection.bru                # Global headers: Authorization: Bearer {{token}}
├── environments/
│   └── Local.bru                 # baseUrl only: http://localhost:3011
├── Auth/                         # Register, Login Admin, Login User, Refresh Token, Logout,
│                                 # Forgot/Reset Password, Verify Email, Resend Verification,
│                                 # MFA Setup/Enable/Disable (these only exist with AUTH_MODE=full)
├── Sessions/
├── Users/
├── Tasks/
└── Audit/
```

## Adding a New `.bru` Request

### 1. Template for Authenticated GET with Query Params
Create `bruno/<Folder>/<Request Name>.bru`:
```bru
meta {
  name: List Items
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}/api/items?page=1&limit=10&order=desc
  body: none
  auth: none
}

params:query {
  page: 1
  limit: 10
  order: desc
  ~search: keyword
}
```

### 2. Template for POST / PUT with JSON Body
```bru
meta {
  name: Create Item
  type: http
  seq: 2
}

post {
  url: {{baseUrl}}/api/items
  body: json
  auth: none
}

headers {
  Content-Type: application/json
}

body:json {
  {
    "title": "Example Title",
    "description": "Example description"
  }
}
```

### 3. Automated Token Propagation (Post-Response Script)
In login requests, store the tokens as runtime variables (they are interpolated as `{{token}}` by the global `Authorization` header in `collection.bru`):
```bru
script:post-response {
  if (res.status === 200 && res.body.accessToken) {
    bru.setVar("token", res.body.accessToken);
    bru.setVar("refreshToken", res.body.refreshToken);
    bru.setVar("sessionId", res.body.sessionId);
  }
}
```

### 4. Document Preconditions in a `docs` Block
Requests depend on the seeded demo data and on who is logged in. State it in the request:
```bru
docs {
  Only administrators: run "Login Admin" first.
  task-1 belongs to the admin; with "Login User" use task-3.
}
```
Prefer example data that does not collide with other requests (e.g. `Auth/Register` uses `registro@example.com`, `Users/Create User` uses `nuevo@example.com`).

## Verifying the Collection
Requests are plain HTTP, so validate them with the official CLI against a server with a fresh database (demo seed data present):
```bash
npx @usebruno/cli run "Tasks/List Tasks.bru" --env Local \
  --env-var baseUrl=http://localhost:3011 --env-var token=<access token>
```
Check that each request returns the status its `docs` block promises. Note that `Auth/Logout` and the session-revoking requests invalidate the current token, and login is rate limited to 10 requests/min per IP.

## Checklist for a New Endpoint
- [ ] One `.bru` file per endpoint/variant in the matching folder, with a unique `seq`.
- [ ] Protected requests rely on the global Bearer header (`auth: none` in the request is intentional).
- [ ] `docs` block explains the required login and any state the request changes.
- [ ] No tokens, secrets or personal data anywhere in the collection.
