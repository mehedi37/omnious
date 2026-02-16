# Omnious — Frontend

> Interactive code-graph visualization with runtime trace animation, error heatmaps, and AI chat.

Part of the [Omnious monorepo](../README.md). Built with Next.js 16 (App Router), React 19, and @xyflow/react for the graph canvas.

---

## Quick Start

```bash
# From monorepo root
npm install
npm run dev --workspace=@omnious/frontend    # http://localhost:3000

# Or via Turborepo (starts all services)
npm run dev
```

## Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 16 (App Router, `output: "standalone"`) |
| **UI** | React 19, shadcn/ui, Tailwind CSS v4 |
| **Graph** | @xyflow/react 12 (React Flow) |
| **State** | Zustand 5 |
| **Data** | tRPC client, @tanstack/react-query |
| **Auth** | Supabase Auth, @supabase/ssr |
| **Linting** | Biome |

## Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/             # Login, signup, callback
│   ├── dashboard/          # Workspace & project views
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Landing page
├── components/
│   ├── ai/                 # AI chat panel, messages, quick actions
│   ├── graph/              # Canvas, controls, nodes, edges, panels
│   ├── project/            # Project CRUD, navigation
│   ├── trace/              # Timeline, span details, playback
│   ├── error/              # Error list, heatmap overlay
│   ├── workspace/          # Workspace management
│   ├── shared/             # Sidebar, command palette, providers
│   └── ui/                 # shadcn/ui primitives
├── hooks/                  # Custom React hooks
│   ├── use-auto-layout.ts
│   ├── use-graph-data.ts
│   ├── use-trace-playback.ts
│   └── ...
├── lib/
│   ├── utils.ts            # cn() and helpers
│   ├── stores/             # Zustand stores
│   ├── supabase/           # Supabase client (SSR + browser)
│   └── oir/                # OIR schema utilities
├── trpc/                   # tRPC client setup
│   ├── client.tsx
│   └── server.tsx
└── workers/
    └── elk-layout.worker.ts  # Web Worker for ELK graph layout
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `NEXT_PUBLIC_API_URL` | No | Backend URL (defaults to `http://localhost:4000`) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build (standalone output) |
| `npm run start` | Start production server |
| `npm run lint` | Lint with Biome |

## Docker

The Docker build runs from the monorepo root context. See the root [docker-compose.yml](../docker-compose.yml).

```bash
# From monorepo root
npm run docker:build
npm run docker:up
```

The production image uses Next.js standalone output (`node frontend/server.js`) for minimal image size.
