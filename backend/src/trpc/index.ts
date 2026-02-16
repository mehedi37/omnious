import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context.js';

/**
 * tRPC initialization.
 *
 * - Uses superjson for transparent Date/Map/Set serialization
 * - Injects full request context (user, db clients, etc.)
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // In production, hide internal error details
        stack:
          process.env['NODE_ENV'] === 'development' ? error.stack : undefined,
      },
    };
  },
});

/** Router factory */
export const router = t.router;

/** Merge routers */
export const mergeRouters = t.mergeRouters;

/** Public procedure — no auth required */
export const publicProcedure = t.procedure;

/**
 * Middleware: require authenticated user.
 * Narrows `ctx.user` from `User | null` to `User`.
 */
const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // non-null after guard
    },
  });
});

/** Protected procedure — requires valid Supabase JWT */
export const protectedProcedure = t.procedure.use(isAuthed);

/**
 * Middleware: require workspace membership.
 * Expects `input.workspaceId` to be present.
 */
const hasWorkspaceAccess = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const rawInput = await opts.getRawInput() as { workspaceId?: string } | undefined;
  const input = rawInput ?? {} as { workspaceId?: string };
  if (!input.workspaceId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'workspaceId is required',
    });
  }

  const { data: member } = await ctx.db
    .from('workspace_members')
    .select('id, role')
    .eq('workspace_id', input.workspaceId)
    .eq('user_id', ctx.user.id)
    .single();

  if (!member) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of this workspace.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      workspaceMember: member,
    },
  });
});

/** Workspace procedure — requires auth + workspace membership */
export const workspaceProcedure = t.procedure
  .use(isAuthed)
  .use(hasWorkspaceAccess);

/**
 * Middleware: require project access (user is member of parent workspace).
 * Expects `input.projectId` to be present.
 */
const hasProjectAccess = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const rawInput = await opts.getRawInput() as { projectId?: string } | undefined;
  const input = rawInput ?? {} as { projectId?: string };
  if (!input.projectId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'projectId is required',
    });
  }

  // Fetch the project + check workspace membership in one query
  const { data: project } = await ctx.db
    .from('projects')
    .select('id, workspace_id, name, slug')
    .eq('id', input.projectId)
    .single();

  if (!project) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Project not found or access denied.',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      project,
    },
  });
});

/** Project procedure — requires auth + project access */
export const projectProcedure = t.procedure
  .use(isAuthed)
  .use(hasProjectAccess);
