import { router } from '../trpc/index.js';
import { healthRouter } from './health.router.js';
import { authRouter } from './auth.router.js';
import { workspaceRouter } from './workspace.router.js';
import { projectRouter } from './project.router.js';
import { graphRouter } from './graph.router.js';
import { traceRouter } from './trace.router.js';
import { errorRouter } from './error.router.js';
import { aiRouter } from './ai.router.js';

/**
 * Root tRPC router — combines all feature routers.
 *
 * API namespace:
 *   health.check         — health check (public)
 *   health.ready          — readiness probe (public)
 *   auth.me               — current user profile
 *   auth.updateProfile    — update profile
 *   workspace.*           — workspace CRUD + members
 *   project.*             — project CRUD
 *   graph.*               — code nodes/edges, semantic search, traversal
 *   trace.*               — trace ingestion + querying
 *   error.*               — error snapshots, heatmap
 *   ai.*                  — AI sessions, BYOK API keys
 */
export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  workspace: workspaceRouter,
  project: projectRouter,
  graph: graphRouter,
  trace: traceRouter,
  error: errorRouter,
  ai: aiRouter,
});

/** Export type for the client-side tRPC type inference */
export type AppRouter = typeof appRouter;
