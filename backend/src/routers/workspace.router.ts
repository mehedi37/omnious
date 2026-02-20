import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  router,
  protectedProcedure,
  workspaceProcedure,
} from '../trpc/index.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
});

const updateWorkspaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  settings: z.record(z.unknown()).optional(),
});

const inviteMemberSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const workspaceRouter = router({
  /** List workspaces the current user belongs to */
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('workspace_members')
      .select(
        `
        role,
        workspace:workspaces (
          id, name, slug, plan, owner_id, settings, created_at, updated_at
        )
      `,
      )
      .eq('user_id', ctx.user.id)
      .order('created_at', {
        referencedTable: 'workspaces',
        ascending: false,
      });

    if (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      });
    }

    return data;
  }),

  /** Get a single workspace by ID */
  getById: workspaceProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('workspaces')
        .select('*')
        .eq('id', input.workspaceId)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      }

      return data;
    }),

  /** Get a single workspace by slug (verifies membership) */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string().min(2).max(50) }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('workspace_members')
        .select(
          `
          role,
          workspace:workspaces!inner (
            id, name, slug, plan, owner_id, settings, created_at, updated_at
          )
        `,
        )
        .eq('user_id', ctx.user.id)
        .eq('workspaces.slug', input.slug)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      }

      return data;
    }),

  /** Create a new workspace */
  create: protectedProcedure
    .input(createWorkspaceSchema)
    .mutation(async ({ ctx, input }) => {
      // Use adminDb to bypass RLS — user has no membership yet
      const { data, error } = await ctx.adminDb
        .from('workspaces')
        .insert({
          name: input.name,
          slug: input.slug,
          owner_id: ctx.user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A workspace with this slug already exists.',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      // Note: the DB trigger `handle_workspace_created` automatically adds
      // the owner to workspace_members, so no manual insert needed.

      return data;
    }),

  /** Update workspace settings */
  update: workspaceProcedure
    .input(updateWorkspaceSchema)
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.settings !== undefined) updates['settings'] = input.settings;

      const { data, error } = await ctx.db
        .from('workspaces')
        .update(updates)
        .eq('id', input.workspaceId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** List members of a workspace */
  listMembers: workspaceProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('workspace_members')
        .select(
          `
          id, role, accepted_at, invited_email, created_at,
          user:profiles (id, display_name, avatar_url)
        `,
        )
        .eq('workspace_id', input.workspaceId);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Invite a member to the workspace */
  inviteMember: workspaceProcedure
    .input(inviteMemberSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if already a member
      const { data: existing } = await ctx.adminDb
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', input.workspaceId)
        .eq('invited_email', input.email)
        .maybeSingle();

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This email has already been invited.',
        });
      }

      // Find user by email or create pending invite
      const { data: targetUser } = await ctx.adminDb.auth.admin.listUsers();
      const matchedUser = targetUser?.users.find(
        (u) => u.email === input.email,
      );

      const { data, error } = await ctx.adminDb
        .from('workspace_members')
        .insert({
          workspace_id: input.workspaceId,
          user_id: matchedUser?.id ?? ctx.user.id, // placeholder until accepted
          role: input.role as 'admin' | 'member' | 'viewer',
          invited_email: input.email,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Remove a member from the workspace */
  removeMember: workspaceProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        memberId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from('workspace_members')
        .delete()
        .eq('id', input.memberId)
        .eq('workspace_id', input.workspaceId);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { success: true };
    }),

  /** Delete a workspace (owner only — enforced by RLS) */
  delete: workspaceProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from('workspaces')
        .delete()
        .eq('id', input.workspaceId);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { success: true };
    }),
});
