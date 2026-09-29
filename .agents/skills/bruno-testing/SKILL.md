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

## Directory Structure
```text
bruno/
├── bruno.json                    # Collection metadata
├── collection.bru                # Global headers: Authorization: Bearer {{token}}
├── environments/
│   └── Local.bru                 # baseUrl: http://localhost:3011
├── Auth/
├── Sessions/
├── Users/
└── Tasks/
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
In login requests, automatically set environment variables:
```bru
script:post-response {
  if (res.status === 200 && res.body.accessToken) {
    bru.setEnvVar("token", res.body.accessToken);
    bru.setEnvVar("refreshToken", res.body.refreshToken);
    bru.setEnvVar("sessionId", res.body.sessionId);
  }
}
```
