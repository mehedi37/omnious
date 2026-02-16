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
| **Frontend** | Next.js 16, React 19, @xyflow/react 12, shadcn/ui, Tailwind v4, Zustand 5, tRPC, Bun |
| **Backend** | Fastify 5, tRPC v11, Zod, Pino, superjson, Node.js |
| **Database** | Supabase (PostgreSQL 15), pgvector, ltree, pg_trgm, RLS |
| **Auth** | Supabase Auth (JWT), @supabase/ssr |

## Project Structure

```
omnious/
├── backend/          # Fastify + tRPC API server
├── frontend/         # Next.js 16 App Router (planned)
├── supabase/         # Database migrations & config
└── .github/
    ├── prompts/      # Implementation plans
    └── workflows/    # CI/CD pipelines
```

## Getting Started

### Prerequisites
- Node.js ≥ 20 (backend)
- Bun (frontend)
- Supabase project (or local via `supabase start`)

### Backend
```bash
cd backend
cp .env.example .env   # Fill in Supabase credentials
npm install
npm run dev            # Starts on :4000
```

### Frontend (coming soon)
```bash
cd frontend
bun install
bun dev                # Starts on :3000
```

### Docker
```bash
# Full stack
docker compose up
```

## Documentation

- [Backend README](backend/README.md) — API reference, setup, schema
- [Frontend Plan](/.github/prompts/plan-frontend.prompt.md) — implementation plan (37 steps)
- [Build Progress](.build-progress.md) — what's done, what's next

## License

Private — all rights reserved.
