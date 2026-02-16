# Omnious — Backend API

> Real-time visual debugging platform for the vibe coding era.

Production-grade tRPC + Fastify backend with Supabase (PostgreSQL + pgvector + RLS) powering **34 API procedures** across 8 domain routers.

---

## Quick Start

```bash
# 1. Copy environment template
cp .env.example .env
# Fill in your Supabase credentials (see .env.example)

# 2. Install dependencies
npm install

# 3. Development (hot-reload)
npm run dev

# 4. Production build
npm run build && npm start
```

### Docker

Docker builds run from the monorepo root context. See the root [docker-compose.yml](../docker-compose.yml).

```bash
# From monorepo root
npm run docker:build
npm run docker:up
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | Yes | — | Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_ANON_KEY` | Yes | — | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Service role key (never expose client-side) |
| `SUPABASE_JWT_SECRET` | Yes | — | JWT secret for token verification |
| `PORT` | No | `4000` | Server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `NODE_ENV` | No | `development` | `development` \| `production` |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |

---

## Architecture

```
Fastify 5 → @trpc/server 11 → Supabase (PostgreSQL 15 + pgvector + RLS)
     │              │
     │         superjson transformer
     │
     ├── @fastify/helmet    (security headers)
     ├── @fastify/cors      (origin control)
     ├── @fastify/rate-limit (request throttling)
     └── @fastify/sensible  (error utilities)
```

### Key Design Decisions

- **Per-request Supabase clients** — each request gets an RLS-scoped client using the user's JWT, so database policies enforce access control automatically
- **Admin client** reserved for service-level operations (trace ingestion via API key, quota checks)
- **tRPC middleware chain**: `publicProcedure` → `protectedProcedure` (auth) → `workspaceProcedure` (+ membership) → `projectProcedure` (+ project access)
- **superjson** for transparent Date/Map/Set serialization

### Directory Structure

```
src/
├── config/
│   ├── env.ts              # Zod-validated environment config
│   └── cors.ts             # CORS origin factory
├── lib/
│   ├── logger.ts           # Pino structured logging
│   └── supabase/
│       ├── client.ts       # Admin + per-request user clients
│       ├── database.types.ts  # Auto-generated types
│       └── index.ts        # Re-exports
├── trpc/
│   ├── context.ts          # JWT extraction, user auth, request context
│   └── index.ts            # tRPC init, middleware, procedure exports
├── routers/
│   ├── index.ts            # Root router combining all feature routers
│   ├── health.router.ts    # Health/readiness probes
│   ├── auth.router.ts      # User profile management
│   ├── workspace.router.ts # Workspace CRUD + members
│   ├── project.router.ts   # Project CRUD + API keys
│   ├── graph.router.ts     # Code graph (nodes, edges, search)
│   ├── trace.router.ts     # Trace/span ingestion + queries
│   ├── error.router.ts     # Error snapshots + heatmap
│   └── ai.router.ts        # AI sessions + BYOK keys
└── server.ts               # Fastify server entry point
```

---

## API Reference

All endpoints are accessed via tRPC at `/trpc`. The plain HTTP health endpoint is at `GET /health`.

### Authentication

Most procedures require a `Bearer <supabase-jwt>` in the `Authorization` header. The `trace.ingest` procedure authenticates via a project API key instead.

### Auth Levels

| Level | Description |
|-------|-------------|
| **public** | No auth required |
| **protected** | Valid Supabase JWT required |
| **workspace** | JWT + workspace membership verified |
| **project** | JWT + project access verified (via parent workspace) |

---

### health

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `health.check` | query | public | Returns status, timestamp, version |
| `health.ready` | query | public | Tests DB connectivity, returns latency |

### auth

| Procedure | Type | Auth | Input | Description |
|-----------|------|------|-------|-------------|
| `auth.me` | query | protected | — | Get current user's profile |
| `auth.updateProfile` | mutation | protected | `displayName?`, `avatarUrl?`, `onboardingCompleted?`, `metadata?` | Update profile |

### workspace

| Procedure | Type | Auth | Input | Description |
|-----------|------|------|-------|-------------|
| `workspace.list` | query | protected | — | List user's workspaces |
| `workspace.getById` | query | workspace | `workspaceId` | Get workspace details |
| `workspace.create` | mutation | protected | `name`, `slug` | Create workspace (slug must be unique) |
| `workspace.update` | mutation | workspace | `workspaceId`, `name?`, `settings?` | Update workspace |
| `workspace.listMembers` | query | workspace | `workspaceId` | List members with profiles |
| `workspace.inviteMember` | mutation | workspace | `workspaceId`, `email`, `role?` | Invite member by email |
| `workspace.removeMember` | mutation | workspace | `workspaceId`, `memberId` | Remove a member |
| `workspace.delete` | mutation | workspace | `workspaceId` | Delete workspace |

### project

| Procedure | Type | Auth | Input | Description |
|-----------|------|------|-------|-------------|
| `project.list` | query | workspace | `workspaceId`, `status?` | List projects |
| `project.getById` | query | project | `projectId` | Get project |
| `project.create` | mutation | workspace | `workspaceId`, `name`, `slug`, `description?`, `gitProvider?`, etc. | Create project |
| `project.update` | mutation | project | `projectId`, `name?`, `description?`, `status?`, etc. | Update project |
| `project.delete` | mutation | project | `projectId` | Delete project |
| `project.regenerateApiKey` | mutation | project | `projectId` | Regenerate project API key |

### graph

| Procedure | Type | Auth | Input | Description |
|-----------|------|------|-------|-------------|
| `graph.listNodes` | query | project | `projectId`, `type?`, `filePath?`, `search?`, pagination | List code nodes with filtering |
| `graph.getNode` | query | project | `projectId`, `nodeId` | Get single code node |
| `graph.listEdges` | query | project | `projectId`, `sourceNodeId?`, `targetNodeId?`, pagination | List code edges |
| `graph.upsertNodes` | mutation | project | `projectId`, `nodes[]` | Bulk upsert code nodes (parser) |
| `graph.upsertEdges` | mutation | project | `projectId`, `edges[]` | Bulk upsert code edges |
| `graph.semanticSearch` | query | project | `projectId`, `embedding[1536]`, `threshold?`, `limit?` | pgvector similarity search |
| `graph.traverse` | query | project | `projectId`, `nodeId`, `direction?`, `maxDepth?` | Recursive graph traversal |

### trace

| Procedure | Type | Auth | Input | Description |
|-----------|------|------|-------|-------------|
| `trace.ingest` | mutation | **API key** | `projectApiKey`, `trace{}`, `spans[]` | Ingest trace + spans (quota checked) |
| `trace.list` | query | project | `projectId`, `status?`, pagination | List traces |
| `trace.getById` | query | project | `projectId`, `traceId` | Get trace with all spans |

### error

| Procedure | Type | Auth | Input | Description |
|-----------|------|------|-------|-------------|
| `error.list` | query | project | `projectId`, `resolved?`, pagination | List errors (joins code_node) |
| `error.heatmap` | query | project | `projectId`, `since?` | Error frequency by code node |
| `error.resolve` | mutation | project | `projectId`, `errorId` | Mark error resolved |
| `error.unresolve` | mutation | project | `projectId`, `errorId` | Reopen error |

### ai

| Procedure | Type | Auth | Input | Description |
|-----------|------|------|-------|-------------|
| `ai.createSession` | mutation | project | `projectId`, `type`, `contextNodeIds?`, `contextTraceId?`, `apiKeyId?` | Create AI session |
| `ai.getSession` | query | protected | `sessionId` | Get session with messages |
| `ai.appendMessage` | mutation | protected | `sessionId`, `messages[]`, `tokenUsage?` | Append messages + track tokens |
| `ai.listSessions` | query | project | `projectId`, pagination | List AI sessions |
| `ai.listApiKeys` | query | protected | — | List BYOK API keys |
| `ai.addApiKey` | mutation | protected | `provider`, `label?`, `encryptedKey`, `keyPrefix?` | Add BYOK API key |
| `ai.deleteApiKey` | mutation | protected | `keyId` | Delete API key |

---

## Database Schema

PostgreSQL 15 with extensions: **pgvector** (1536-dim embeddings), **ltree** (hierarchy paths), **pg_trgm** (fuzzy search), **pgcrypto** (encryption), **moddatetime** (auto timestamps).

### Tables (15)

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `profiles` | User profiles (synced from Supabase Auth) | PK for all user references |
| `workspaces` | Team/org containers | `owner_id → profiles` |
| `workspace_members` | Workspace membership + roles | `workspace_id → workspaces`, `user_id → profiles` |
| `projects` | Repos/codebases to debug | `workspace_id → workspaces` |
| `code_nodes` | OIR graph nodes (functions, classes, etc.) | `project_id → projects` |
| `code_edges` | OIR graph edges (calls, imports, etc.) | `source/target_node_id → code_nodes` |
| `traces` | Distributed trace roots | `project_id → projects` |
| `spans` | Individual spans within traces | `trace_id → traces`, `code_node_id → code_nodes` |
| `error_snapshots` | Deduplicated error occurrences | `code_node_id → code_nodes`, `trace_id → traces` |
| `ai_sessions` | AI conversation sessions | `project_id → projects`, `user_id → profiles` |
| `user_api_keys` | BYOK encrypted API keys | `user_id → profiles` |
| `saved_views` | Persisted graph view states | `project_id → projects`, `user_id → profiles` |
| `parser_registry` | OIR parser plugins | `author_id → profiles` |
| `audit_log` | Immutable audit trail | `user_id → profiles`, `workspace_id → workspaces` |
| `billing_events` | Usage metering events | `workspace_id → workspaces` |

### Enums

| Enum | Values |
|------|--------|
| `oir_node_type` | module, component, function, class, route, middleware, database_query, event_emitter, event_listener, external_api, variable, type_def |
| `oir_edge_type` | calls, imports, extends, implements, renders, routes_to, queries, emits_event, subscribes_to, redirects_to, uses, exports |
| `trace_status` | ok, error, timeout, partial |
| `project_status` | active, archived, importing, error |
| `subscription_plan` | free, pro, team, enterprise |
| `workspace_role` | owner, admin, member, viewer |
| `ai_session_type` | explain_flow, why_broke, fix_it, general, security_scan, translate |
| `git_provider` | github, gitlab, bitbucket, local |

### RPC Functions

| Function | Description |
|----------|-------------|
| `match_code_nodes(embedding, project_id, threshold, count)` | pgvector cosine similarity search |
| `traverse_graph(node_id, direction, max_depth)` | Recursive CTE graph traversal |
| `get_error_heatmap(project_id, since)` | Error frequency aggregation by node |
| `check_trace_quota(project_id)` | Monthly trace count vs quota |
| `upsert_error_snapshot(...)` | Deduplicated error insertion |

### Security

- **Row Level Security (RLS)** enabled on all 15 tables
- Every table policy scopes reads/writes to workspace membership
- `traces` and `spans` allow insert via service role (API key ingestion)
- `audit_log` is insert-only (no updates or deletes)
- `profiles` auto-created via database trigger on `auth.users` insert

---

## CI/CD

Unified Turborepo pipeline at `.github/workflows/ci.yml` — runs lint, typecheck, build, and Docker push for all packages on push/PR to `main`.

---

## Licensing & Commercial Use

All dependencies are permissively licensed and safe for commercial use:

| Component | License | Commercial OK |
|-----------|---------|---------------|
| **Fastify** | MIT | ✅ |
| **tRPC** | MIT | ✅ |
| **Supabase JS Client** | MIT | ✅ |
| **PostgreSQL** | PostgreSQL License (permissive) | ✅ |
| **pgvector** | PostgreSQL License | ✅ |
| **Zod** | MIT | ✅ |
| **Pino** | MIT | ✅ |
| **superjson** | MIT | ✅ |

### Supabase Hosting

- **Self-hosted**: Supabase is open-source (Apache 2.0 core). You can self-host with no licensing fees.
- **Supabase Cloud**: Free tier available. Paid tiers (Pro at $25/mo, Team, Enterprise) scale with usage. No per-seat charges for your end-users.
- **Limits to watch**: Database size, edge function invocations, storage, and bandwidth scale with plan tier. Realtime connections have per-plan caps.

### No Data Sharing

This backend does **not** send telemetry, analytics, or any project data to third parties. All data stays in your Supabase instance. The only external calls are:
- Supabase Auth (your own instance)
- Any AI provider calls you configure via BYOK API keys (OpenAI, etc.)

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot-reload (tsx watch) |
| `npm run build` | TypeScript compilation |
| `npm start` | Start production server |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:types` | Regenerate Supabase types |
| `npm run clean` | Remove dist, node_modules, .turbo |
