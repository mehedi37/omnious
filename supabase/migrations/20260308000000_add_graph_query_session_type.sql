-- Add 'graph_query' to ai_session_type enum so graph-mode AI conversations
-- can be persisted as proper sessions alongside standalone sessions.

ALTER TYPE "public"."ai_session_type" ADD VALUE IF NOT EXISTS 'graph_query';
