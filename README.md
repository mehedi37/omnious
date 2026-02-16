# Omnious

> Visual debugging platform — interactive code-graph visualization with real-time trace animation, error heatmaps, and AI-powered diagnosis.

Omnious transforms codebases into zoomable node-graphs, overlays runtime traces as animated data-flow paths, highlights error hotspots with heatmaps, and provides AI-assisted debugging through a chat interface.

---

## Architecture

```
┌─────────────┐     tRPC/HTTP      ┌─────────────┐     SQL/RPC      ┌─────────────┐
│   Frontend   │ ◄──────────────► │   Backend    │ ◄──────────────► │  Supabase    │
│  Next.js 16  │    :3000→:4000    │  Fastify 5   │                  │  PostgreSQL  │
│  React 19    │                   │  tRPC v11    │                  │  pgvector    │
│  React Flow  │                   │              │                  │  RLS         │
└─────────────┘                    └─────────────┘                   └─────────────┘
```

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16, React 19, @xyflow/react 12, shadcn/ui, Tailwind v4, Zustand 5, tRPC |
| **Backend** | Fastify 5, tRPC v11, Zod, Pino, superjson, Node.js |
| **Database** | Supabase (PostgreSQL 15), pgvector, ltree, pg_trgm, RLS |
| **Auth** | Supabase Auth (JWT), @supabase/ssr |
| **Tooling** | Turborepo, npm workspaces, Docker, GitHub Actions |

## Project Structure

```
omnious/                    # Turborepo monorepo root
├── frontend/               # Next.js 16 App Router
├── backend/                # Fastify + tRPC API server
├── cli/                    # Omnious CLI (planned)
├── mcp/                    # MCP server (planned)
├── supabase/               # Database migrations & config
├── docker-compose.yml      # Full-stack Docker orchestration
├── turbo.json              # Turborepo task pipeline
├── package.json            # npm workspace root
└── .github/
    ├── prompts/            # Implementation plans
    └── workflows/          # CI/CD pipelines
```

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Supabase** project (cloud or self-hosted via `supabase start`)

### Setup

```bash
# 1. Clone and install all workspace dependencies
git clone <repo-url> && cd omnious
npm install

# 2. Configure environment
cp .env.example .env
# Fill in your Supabase credentials (see .env.example)

# 3. Start development (all services via Turborepo)
npm run dev
```

The frontend starts on `:3000`, the backend on `:4000`.

### Individual Services

```bash
# Frontend only
npm run dev --workspace=@omnious/frontend

# Backend only
npm run dev --workspace=@omnious/backend
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services in dev mode (Turborepo) |
| `npm run build` | Build all packages |
| `npm run lint` | Lint all packages |
| `npm run typecheck` | Type-check all packages |
| `npm run test` | Run tests across all packages |
| `npm run clean` | Remove build artifacts and node_modules |
| `npm run docker:build` | Build Docker images |
| `npm run docker:up` | Start production stack |
| `npm run docker:down` | Stop production stack |
| `npm run docker:logs` | Follow container logs |
| `npm run db:types` | Regenerate Supabase TypeScript types |

## Docker Deployment

Both services use multi-stage Docker builds with the monorepo root as build context.

```bash
# 1. Configure environment
cp .env.example .env

# 2. Build and start
npm run docker:build
npm run docker:up

# 3. Check logs
npm run docker:logs

# 4. Stop
npm run docker:down
```

The Docker setup expects Supabase hosted externally. Use a reverse proxy (Caddy, Traefik, nginx) for HTTPS termination in production.

| Service | Image Base | Port | Notes |
|---------|-----------|------|-------|
| Frontend | `node:22-alpine` | 3000 | Next.js standalone output |
| Backend | `node:22-alpine` | 4000 | tini for PID 1, healthcheck |

## Documentation

- [Frontend README](frontend/README.md) — component architecture, stack details
- [Backend README](backend/README.md) — API reference (34 procedures), schema, setup

## License

Private — all rights reserved.
