export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_sessions: {
        Row: {
          api_key_id: string | null
          completion_tokens: number
          context_node_ids: string[] | null
          context_trace_id: string | null
          created_at: string
          error_message: string | null
          id: string
          messages: Json
          metadata: Json
          model: string | null
          project_id: string
          prompt_tokens: number
          status: string
          total_tokens: number
          type: Database["public"]["Enums"]["ai_session_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_id?: string | null
          completion_tokens?: number
          context_node_ids?: string[] | null
          context_trace_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          messages?: Json
          metadata?: Json
          model?: string | null
          project_id: string
          prompt_tokens?: number
          status?: string
          total_tokens?: number
          type: Database["public"]["Enums"]["ai_session_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_id?: string | null
          completion_tokens?: number
          context_node_ids?: string[] | null
          context_trace_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          messages?: Json
          metadata?: Json
          model?: string | null
          project_id?: string
          prompt_tokens?: number
          status?: string
          total_tokens?: number
          type?: Database["public"]["Enums"]["ai_session_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_sessions_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "user_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sessions_context_trace_id_fkey"
            columns: ["context_trace_id"]
            isOneToOne: false
            referencedRelation: "traces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          id: string
          ip_address: unknown
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: unknown
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          period_start: string
          quantity: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          period_start?: string
          quantity?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          period_start?: string
          quantity?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      code_edges: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          project_id: string
          source_node_id: string
          target_node_id: string
          type: Database["public"]["Enums"]["oir_edge_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          project_id: string
          source_node_id: string
          target_node_id: string
          type: Database["public"]["Enums"]["oir_edge_type"]
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          project_id?: string
          source_node_id?: string
          target_node_id?: string
          type?: Database["public"]["Enums"]["oir_edge_type"]
        }
        Relationships: [
          {
            foreignKeyName: "code_edges_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_edges_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "code_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_edges_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "code_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      code_nodes: {
        Row: {
          content_hash: string
          created_at: string
          doc_comment: string | null
          embedding: string | null
          file_path: string
          id: string
          line_end: number | null
          line_start: number | null
          metadata: Json
          name: string
          oir_id: string
          oir_version: string
          project_id: string
          signature: string | null
          tree_path: unknown
          type: Database["public"]["Enums"]["oir_node_type"]
          updated_at: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          doc_comment?: string | null
          embedding?: string | null
          file_path: string
          id?: string
          line_end?: number | null
          line_start?: number | null
          metadata?: Json
          name: string
          oir_id: string
          oir_version?: string
          project_id: string
          signature?: string | null
          tree_path?: unknown
          type: Database["public"]["Enums"]["oir_node_type"]
          updated_at?: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          doc_comment?: string | null
          embedding?: string | null
          file_path?: string
          id?: string
          line_end?: number | null
          line_start?: number | null
          metadata?: Json
          name?: string
          oir_id?: string
          oir_version?: string
          project_id?: string
          signature?: string | null
          tree_path?: unknown
          type?: Database["public"]["Enums"]["oir_node_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      device_codes: {
        Row: {
          access_token: string | null
          created_at: string
          device_code: string
          expires_at: string
          poll_interval: number
          refresh_token: string | null
          status: string
          user_code: string
          user_email: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          device_code: string
          expires_at: string
          poll_interval?: number
          refresh_token?: string | null
          status?: string
          user_code: string
          user_email?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          device_code?: string
          expires_at?: string
          poll_interval?: number
          refresh_token?: string | null
          status?: string
          user_code?: string
          user_email?: string | null
        }
        Relationships: []
      }
      error_snapshots: {
        Row: {
          code_node_id: string | null
          created_at: string
          error_message: string
          error_stack: string | null
          error_type: string | null
          fingerprint: string
          first_seen_at: string
          id: string
          last_seen_at: string
          metadata: Json
          occurrence_count: number
          project_id: string
          resolved_at: string | null
          resolved_by: string | null
          span_id: string | null
          trace_id: string | null
        }
        Insert: {
          code_node_id?: string | null
          created_at?: string
          error_message: string
          error_stack?: string | null
          error_type?: string | null
          fingerprint: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          occurrence_count?: number
          project_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          span_id?: string | null
          trace_id?: string | null
        }
        Update: {
          code_node_id?: string | null
          created_at?: string
          error_message?: string
          error_stack?: string | null
          error_type?: string | null
          fingerprint?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          occurrence_count?: number
          project_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          span_id?: string | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_snapshots_code_node_id_fkey"
            columns: ["code_node_id"]
            isOneToOne: false
            referencedRelation: "code_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_snapshots_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_snapshots_span_id_fkey"
            columns: ["span_id"]
            isOneToOne: false
            referencedRelation: "spans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_snapshots_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "traces"
            referencedColumns: ["id"]
          },
        ]
      }
      parser_registry: {
        Row: {
          author_id: string | null
          config_schema: Json
          created_at: string
          description: string | null
          downloads: number
          framework: string | null
          id: string
          is_official: boolean
          is_public: boolean
          language: string
          name: string
          rating: number | null
          slug: string
          supported_extensions: string[]
          updated_at: string
          version: string
        }
        Insert: {
          author_id?: string | null
          config_schema?: Json
          created_at?: string
          description?: string | null
          downloads?: number
          framework?: string | null
          id?: string
          is_official?: boolean
          is_public?: boolean
          language: string
          name: string
          rating?: number | null
          slug: string
          supported_extensions?: string[]
          updated_at?: string
          version?: string
        }
        Update: {
          author_id?: string | null
          config_schema?: Json
          created_at?: string
          description?: string | null
          downloads?: number
          framework?: string | null
          id?: string
          is_official?: boolean
          is_public?: boolean
          language?: string
          name?: string
          rating?: number | null
          slug?: string
          supported_extensions?: string[]
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "parser_registry_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          metadata: Json
          onboarding_completed: boolean
          plan: Database["public"]["Enums"]["subscription_plan"]
          plan_expires_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          metadata?: Json
          onboarding_completed?: boolean
          plan?: Database["public"]["Enums"]["subscription_plan"]
          plan_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          metadata?: Json
          onboarding_completed?: boolean
          plan?: Database["public"]["Enums"]["subscription_plan"]
          plan_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          api_key: string
          created_at: string
          description: string | null
          detected_stack: Json
          framework: string | null
          git_branch: string | null
          git_provider: Database["public"]["Enums"]["git_provider"] | null
          git_token_enc: string | null
          git_url: string | null
          id: string
          last_index_hash: string | null
          last_indexed_at: string | null
          name: string
          oir_version: string | null
          otel_endpoint: string | null
          primary_language: string | null
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["project_status"]
          trace_quota: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          api_key?: string
          created_at?: string
          description?: string | null
          detected_stack?: Json
          framework?: string | null
          git_branch?: string | null
          git_provider?: Database["public"]["Enums"]["git_provider"] | null
          git_token_enc?: string | null
          git_url?: string | null
          id?: string
          last_index_hash?: string | null
          last_indexed_at?: string | null
          name: string
          oir_version?: string | null
          otel_endpoint?: string | null
          primary_language?: string | null
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["project_status"]
          trace_quota?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          api_key?: string
          created_at?: string
          description?: string | null
          detected_stack?: Json
          framework?: string | null
          git_branch?: string | null
          git_provider?: Database["public"]["Enums"]["git_provider"] | null
          git_token_enc?: string | null
          git_url?: string | null
          id?: string
          last_index_hash?: string | null
          last_indexed_at?: string | null
          name?: string
          oir_version?: string | null
          otel_endpoint?: string | null
          primary_language?: string | null
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["project_status"]
          trace_quota?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          created_at: string
          description: string | null
          filters: Json
          id: string
          is_shared: boolean
          name: string
          project_id: string
          updated_at: string
          user_id: string
          viewport: Json | null
          visible_nodes: string[] | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          is_shared?: boolean
          name: string
          project_id: string
          updated_at?: string
          user_id: string
          viewport?: Json | null
          visible_nodes?: string[] | null
        }
        Update: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          is_shared?: boolean
          name?: string
          project_id?: string
          updated_at?: string
          user_id?: string
          viewport?: Json | null
          visible_nodes?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      spans: {
        Row: {
          attributes: Json
          code_node_id: string | null
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          error_message: string | null
          error_stack: string | null
          events: Json
          id: string
          kind: string | null
          operation: string
          parent_span_id: string | null
          project_id: string
          service_name: string | null
          span_id: string
          started_at: string
          status: Database["public"]["Enums"]["trace_status"]
          trace_id: string
        }
        Insert: {
          attributes?: Json
          code_node_id?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          error_stack?: string | null
          events?: Json
          id?: string
          kind?: string | null
          operation: string
          parent_span_id?: string | null
          project_id: string
          service_name?: string | null
          span_id: string
          started_at: string
          status?: Database["public"]["Enums"]["trace_status"]
          trace_id: string
        }
        Update: {
          attributes?: Json
          code_node_id?: string | null
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          error_stack?: string | null
          events?: Json
          id?: string
          kind?: string | null
          operation?: string
          parent_span_id?: string | null
          project_id?: string
          service_name?: string | null
          span_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["trace_status"]
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spans_code_node_id_fkey"
            columns: ["code_node_id"]
            isOneToOne: false
            referencedRelation: "code_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spans_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "traces"
            referencedColumns: ["id"]
          },
        ]
      }
      traces: {
        Row: {
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          error_message: string | null
          http_method: string | null
          http_status: number | null
          http_url: string | null
          id: string
          project_id: string
          root_operation: string | null
          root_service: string | null
          started_at: string
          status: Database["public"]["Enums"]["trace_status"]
          tags: Json
          trace_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          http_method?: string | null
          http_status?: number | null
          http_url?: string | null
          id?: string
          project_id: string
          root_operation?: string | null
          root_service?: string | null
          started_at: string
          status?: Database["public"]["Enums"]["trace_status"]
          tags?: Json
          trace_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          http_method?: string | null
          http_status?: number | null
          http_url?: string | null
          id?: string
          project_id?: string
          root_operation?: string | null
          root_service?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["trace_status"]
          tags?: Json
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "traces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_api_keys: {
        Row: {
          created_at: string
          encrypted_key: string
          id: string
          is_active: boolean
          key_prefix: string | null
          label: string
          last_used_at: string | null
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          is_active?: boolean
          key_prefix?: string | null
          label?: string
          last_used_at?: string | null
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          is_active?: boolean
          key_prefix?: string | null
          label?: string
          last_used_at?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_email: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_trace_quota: { Args: { p_project_id: string }; Returns: boolean }
      get_error_heatmap: {
        Args: { p_project_id: string; p_since?: string }
        Returns: {
          code_node_id: string
          node_name: string
          node_type: Database["public"]["Enums"]["oir_node_type"]
          file_path: string
          error_count: number
          unique_errors: number
          last_error_at: string
          severity: string
        }[]
      }
      match_code_nodes: {
        Args: {
          query_embedding: string
          match_project_id: string
          match_threshold?: number
          match_count?: number
        }
        Returns: {
          id: string
          oir_id: string
          name: string
          type: Database["public"]["Enums"]["oir_node_type"]
          file_path: string
          line_start: number
          line_end: number
          similarity: number
        }[]
      }
      traverse_graph: {
        Args: { p_node_id: string; p_direction?: string; p_max_depth?: number }
        Returns: {
          depth: number
          node_id: string
          node_name: string
          node_type: Database["public"]["Enums"]["oir_node_type"]
          edge_type: Database["public"]["Enums"]["oir_edge_type"]
          parent_node_id: string
        }[]
      }
      upsert_error_snapshot: {
        Args: {
          p_project_id: string
          p_code_node_id: string
          p_trace_id: string
          p_span_id: string
          p_error_type: string
          p_error_message: string
          p_error_stack: string
          p_fingerprint: string
          p_metadata?: Json
        }
        Returns: string
      }
    }
    Enums: {
      ai_session_type:
        | "explain_flow"
        | "why_broke"
        | "fix_it"
        | "general"
        | "security_scan"
        | "translate"
      git_provider: "github" | "gitlab" | "bitbucket" | "local"
      oir_edge_type:
        | "calls"
        | "imports"
        | "extends"
        | "implements"
        | "renders"
        | "routes_to"
        | "queries"
        | "emits_event"
        | "subscribes_to"
        | "redirects_to"
        | "uses"
        | "exports"
      oir_node_type:
        | "module"
        | "component"
        | "function"
        | "class"
        | "route"
        | "middleware"
        | "database_query"
        | "event_emitter"
        | "event_listener"
        | "external_api"
        | "variable"
        | "type_def"
      project_status: "active" | "archived" | "importing" | "error"
      subscription_plan: "free" | "pro" | "team" | "enterprise"
      trace_status: "ok" | "error" | "timeout" | "partial"
      workspace_role: "owner" | "admin" | "member" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ─── Convenience helpers ─────────────────────────────────────────

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  T extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]),
> = (DefaultSchema["Tables"] & DefaultSchema["Views"])[T] extends {
  Row: infer R
}
  ? R
  : never

export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Insert: infer I } ? I : never

export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Update: infer U } ? U : never

export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]

export type DbFunctions = DefaultSchema["Functions"]
