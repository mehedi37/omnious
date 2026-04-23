# Omnious — Project Overview

> Last updated: April 2026

---

## What Is Omnious?

Omnious is a **visual debugging and code-intelligence platform** for software developers. It transforms any codebase into an interactive, zoomable graph of nodes and relationships, then overlays real-time runtime data — execution traces, error heatmaps, and AI-generated analysis — directly onto that graph.

The core idea is simple: **stop debugging blind**. Most debugging tools show you logs, stack traces, or isolated line-by-line stepping. Omnious shows you *the whole picture* — which parts of your code are called during a request, where errors cluster, how modules depend on each other, and what the AI thinks is wrong — all in one place.

---

## The Problem It Solves

Modern codebases are large and interconnected. When something breaks:

1. You get a stack trace with no visual context of *why* that code path was reached.
2. Error aggregators (Sentry, Datadog) show frequency but not *architectural cause*.
3. AI chat tools (Copilot, Claude) answer questions about files you show them, but they have no persistent memory of your project's structure.
4. Code review is done file-by-file with no understanding of the bigger dependency graph.

Omnious addresses all four by maintaining a living **Object Intermediate Representation (OIR)** graph of your codebase — a parsed, structured model of every file, function, class, module, and the edges between them — and linking that to actual runtime behavior.

---

## Goals

### Short Term (current)
- Index any TypeScript/JavaScript project into a graph via the CLI
- Visualize the graph interactively in the browser with focus, filter, and zoom
- Overlay runtime traces as animated paths through the graph
- Highlight error hotspots (heatmap) by node
- Provide AI-assisted root-cause analysis tied to specific graph nodes

### Medium Term
- Multi-language support (Python, Go, Rust parsers for the CLI)
- Real-time trace streaming (WebSocket-based ingestion from running apps)
- Collaborative debugging sessions (multi-user graph interaction)
- IDE plugins for jump-to-graph from VS Code / JetBrains

### Long Term
- Automated refactor suggestions grounded in graph structure
- Security scan mode (trace data-flow paths for PII, auth, injection risks)
- Public registry of graph "slices" — shareable architectural snapshots
- Self-hosted enterprise edition with private AI models

---

## Product Walkthrough

### 1. Index Your Codebase (CLI)

The **Omnious CLI** (`@omnious/cli`) parses your project and produces an OIR index:

```bash
npx @omnious/cli index   # parse source files → .omnious/index.json
npx @omnious/cli push    # upload to Omnious backend
```

The CLI supports differential push — it hashes files and only uploads what changed since the last push. It also runs configurable lint rules at push time and can report errors from your existing error monitoring.

CLI commands:

| Command | Purpose |
|---------|---------|
| `init` | Initialise `.omnious/config.json` for a project |
| `login` | Authenticate with device-flow OAuth |
| `index` | Parse the codebase into `.omnious/index.json` |
| `push` | Upload the index to the backend (differential) |
| `sync` | `index` + `push` in one step |
| `status` | Show what has changed since the last push |
| `summarize` | Trigger AI doc-comment generation for nodes |
| `report-error` | Manually report an error snapshot |
| `memory` | View or query the project's AI memory |

---

### 2. Explore the Graph (Dashboard)

Once indexed, open the project in the Omnious dashboard:

```
https://<your-instance>/dashboard/<workspace>/<project>/graph
```

The graph page is the main surface. It has three panels:

- **Left panel** — AST file tree. Click any file to highlight its nodes on the canvas.
- **Center** — D3 canvas. Nodes represent code entities (functions, classes, modules, files, packages). Edges represent calls, imports, extends, implements relationships. Supports zoom/pan, focus mode (2-hop neighbourhood fog), node filters (by type, search), and right-click context menu.
- **Right panel** — Inspector. Shows node details (signature, file path, doc comment, errors, traces) and an AI chat tab.

Key graph interactions:

| Action | How |
|--------|-----|
| Focus on a node | Right-click → Focus (2-hop) |
| Explore dependencies | Right-click → Expand Dependencies (triggers AI query) |
| View node errors | Right-click → Show Errors |
| Ask AI about a node | Right-click → Ask AI |
| Replay a trace on the graph | Traces page → Play button |
| Jump to a node from an error | Error detail → Focus on Graph |

---

### 3. Traces

The **Traces page** (`/traces`) lists all execution traces ingested via `trace.ingest`. Each trace contains spans mapped to specific code nodes. Selecting a trace and clicking **Replay on Graph** animates the execution path as a flow through the graph canvas — each span lights up the relevant node in sequence.

Trace data is ingested via the backend API using the project API key:

```
POST /trpc/trace.ingest
Authorization: Bearer <project-api-key>
Body: { trace: {...}, spans: [...] }
```

---

### 4. Errors

The **Errors page** (`/errors`) lists all error snapshots grouped by `error_type`. Each error links to the code node where it occurred. The **Error Detail** view shows:

- Occurrence count, first/last seen timestamps
- The code node and file path
- Linked trace (if available)
- AI quick actions: **Why Broke** (generates root-cause explanation) and **Fix It** (generates a fix suggestion)
- Navigate between errors with ← → prev/next arrows

The graph page shows an **Error Heatmap** overlay — nodes with higher error counts glow red, giving an instant architectural view of where the pain is concentrated.

---

### 5. AI Chat

The **AI page** (`/ai`) and the **Inspector AI tab** (graph panel) both offer a persistent AI chat interface. Each conversation is an **AI session** with a type (`why_broke`, `fix_it`, `explain_flow`, `general`, `graph_query`, etc.) and a list of pinned context nodes.

The AI has access to:
- The full OIR graph (via semantic search and subgraph queries)
- AI-generated code summaries for every node
- Error snapshots and their stack traces
- Trace execution paths
- A persistent **MemPalace** (long-term memory) of past insights for the project

AI sessions auto-generate a descriptive title (e.g. *"Auth token expiry leak"*) rather than a generic label.

**AI graph queries** can produce named **graph slices** — saved views of a subgraph relevant to a question. Slices appear in the Inspector and can be replayed.

---

### 6. MCP Server

The **Omnious MCP server** (`@omnious/mcp`) exposes 9 tools to AI coding assistants (GitHub Copilot, Claude Desktop, Cursor) via the Model Context Protocol:

| Tool | What it does |
|------|-------------|
| `query_graph` | Natural language search over the code graph |
| `get_node_details` | Full details for a specific node |
| `get_architecture_overview` | High-level codebase summary |
| `explain_error` | AI root-cause analysis for an error |
| `suggest_refactor` | Refactoring suggestions |
| `omnious_recall` | Search past AI insights |
| `omnious_store_insight` | Save a new insight to project memory |
| `omnious_project_context` | Get the AI-generated project profile |
| `omnious_knowledge_timeline` | Browse insights chronologically |

See [mcp/README.md](../mcp/README.md) for full setup instructions.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                         Browser                          │
│   Next.js 16 · React 19 · D3 Canvas · Zustand · tRPC    │
└─────────────────────────────┬────────────────────────────┘
                              │ tRPC over HTTP (port 3000 → 4000)
┌─────────────────────────────▼────────────────────────────┐
│                         Backend                          │
│          Fastify 5 · tRPC v11 · Zod · Pino              │
│                                                          │
│  Routers: health · auth · workspace · project ·         │
│           graph · trace · error · ai                     │
└──────────┬──────────────────────────────────┬────────────┘
           │ SQL / Supabase JS SDK             │ Ollama HTTP API
┌──────────▼──────────┐              ┌─────────▼───────────┐
│      Supabase        │              │        Ollama        │
│  PostgreSQL 15       │              │  gemma4:latest       │
│  pgvector (768d)     │              │  nomic-embed-text    │
│  pg_trgm · ltree     │              └─────────────────────┘
│  Row Level Security  │
└─────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                     CLI (local tool)                     │
│            Node.js · TypeScript · OIR parser            │
│   index → push → sync → status → summarize             │
└─────────────────────────────────────────────────────────┘
```

### Database Schema (key tables)

| Table | Purpose |
|-------|---------|
| `workspaces` | Top-level org / team container |
| `workspace_members` | User ↔ workspace membership |
| `projects` | A codebase / repository |
| `code_nodes` | Every parsed code entity (function, class, module…) |
| `code_edges` | Relationships between nodes (calls, imports, extends…) |
| `code_summaries` | AI-generated doc comments per node |
| `code_node_clusters` | Community-detected groups of related nodes |
| `traces` | Execution traces ingested from apps |
| `spans` | Individual spans within a trace |
| `error_snapshots` | Deduplicated error events with occurrence counts |
| `ai_sessions` | AI chat conversations with message history |
| `ai_session_insights` | Extracted insight facts from AI sessions |
| `global_knowledge` | Project-level MemPalace entries |
| `ai_graph_slices` | Saved named subgraph views |
| `project_documents` | Uploaded documentation for RAG |
| `user_api_keys` | BYOK (Bring Your Own Key) provider API keys |

### OIR — Object Intermediate Representation

The OIR is the canonical data model for a parsed codebase. Key types (defined in `packages/shared`):

- **`CodeNode`** — `id`, `oir_id`, `type` (function / class / module / file / package / …), `name`, `file_path`, `signature`, `doc_comment`, `code_body`, `embedding`
- **`CodeEdge`** — `source_node_id`, `target_node_id`, `type` (calls / imports / extends / implements / …)
- **`Trace`** + **`Span`** — runtime execution records linked to `code_node_id` via OIR IDs
- **`ErrorSnapshot`** — deduplicated error record with `code_node_id`, `error_type`, `stack_trace`, `occurrence_count`

---

## Tech Stack Summary

| Layer | Technologies |
|-------|-------------|
| **Frontend** | Next.js 16 (App Router), React 19, D3 (custom canvas engine), shadcn/ui, Tailwind v4, Zustand 5, tRPC client, @tanstack/react-query |
| **Backend** | Fastify 5, tRPC v11, Zod, Pino, superjson, Node.js 22 |
| **Database** | Supabase (PostgreSQL 15), pgvector (768-dim embeddings), pg_trgm, ltree, Row Level Security |
| **Auth** | Supabase Auth (JWT), device-flow OAuth for CLI |
| **AI / LLM** | Ollama (local), BYOK support for OpenAI / Anthropic / Google |
| **CLI** | Node.js, TypeScript, tsup, Commander-style commands |
| **MCP** | `@modelcontextprotocol/sdk`, stdio transport |
| **Monorepo** | Turborepo, npm workspaces |
| **Infra** | Docker multi-stage builds, docker-compose, GitHub Actions CI |

---

## Current State (April 2026)

### ✅ Fully Working

- **Authentication** — sign-up, login, session management, CLI device-flow login
- **Workspace & project management** — create workspaces, invite members, create projects, regenerate API keys
- **CLI indexing and push** — differential push with file hashing, batch upload of nodes/edges, lint rules at push time
- **Code graph canvas** — D3-based canvas with physics simulation, zoom/pan, focus mode (2-hop fog), edge filters, node type filters, search
- **Context menu** — focus, expand dependencies, view details, show errors, trace error path, ask AI, copy name, hide node type
- **Inspector panel** — node details, file path, signature, doc comments, error count, trace count
- **AI chat** — persistent sessions, streaming responses, code block rendering, context node pinning, graph query mode
- **Graph slices** — AI-generated named subgraph views, saved and replayable
- **Error list + heatmap** — full error list with pagination, heatmap overlay on graph, error detail with resolve/reopen
- **Error prev/next navigation** — navigate between errors in the detail view
- **Trace list + pagination** — paginated trace table (25 per page), status badges, HTTP method colors
- **Trace replay** — animate execution path on the graph canvas, play/pause/step/seek controls
- **MemPalace** — persistent AI memory (store/recall insights) per project
- **AI session naming** — LLM-generated punchy session titles instead of generic patterns
- **Graph slice naming** — entry-point node name as slice title instead of raw query text
- **Project overview** — stats grid (nodes, edges, traces, errors), AI coverage, node type breakdown, API key card with CLI quickstart
- **Push notifications** — Supabase Realtime triggers graph refresh when CLI pushes
- **Keyboard shortcuts** — focus, search, panel toggles
- **MCP server** — 9 tools, stdio transport, documented setup for VS Code / Claude Desktop / Cursor

### 🔄 Partially Working / Known Gaps

- **BYOK (Bring Your Own Key)** — backend infrastructure complete, UI paused; AI currently routes through the server's Ollama instance
- **Error "Fix It" flow** — generates a suggestion but no apply-to-file mechanism yet
- **Code summaries** — generated via `omnious summarize` CLI but not yet visible in the Inspector UI
- **CLI `report-error` command** — implemented but not yet hooked up to auto-report from framework integrations (Express middleware, Next.js error boundary, etc.)
- **Responsive / mobile layout** — mobile sheets exist but graph interaction is desktop-optimised

### ⏳ Planned / Not Yet Started

- **Python, Go, Rust CLI parsers** — currently TypeScript/JavaScript only
- **Real-time trace streaming** — currently batch ingestion only; WebSocket streaming planned
- **Collaborative sessions** — single-user only today
- **IDE plugins** — VS Code extension (jump-to-graph, inline heatmap decorations)
- **Public slice registry** — shareable architectural snapshots
- **Self-hosted enterprise packaging** — Helm chart, SSO, audit log

---

## Repo Structure

```
omnious/
├── frontend/          Next.js 16 App Router dashboard
├── backend/           Fastify 5 + tRPC v11 API server
├── cli/               Omnious CLI (@omnious/cli)
├── mcp/               MCP server (@omnious/mcp)
├── packages/
│   └── shared/        OIR types, constants shared by all packages
├── supabase/
│   ├── config.toml
│   └── migrations/    25+ versioned SQL migrations
├── docs/              ← you are here
├── docker-compose.yml
├── turbo.json
└── package.json
```

---

## Running Locally

### Prerequisites

- Node.js ≥ 20, npm ≥ 10
- Supabase project (cloud or `supabase start` locally)
- Ollama running with `gemma4:latest` and `nomic-embed-text-v2-moe` pulled

```bash
git clone <repo> && cd omnious
npm install

cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET

npm run dev          # starts frontend :3000 and backend :4000 via Turborepo
```

Then index your first project:

```bash
cd /path/to/your-project
export OMNIOUS_API_KEY="<key from project overview page>"
npx @omnious/cli init
npx @omnious/cli index && npx @omnious/cli push
```
