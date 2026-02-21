import type { OIRNode, OIREdge, PushResult, ProjectStatus } from '../oir/types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_SERVER_ERROR',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Thin HTTP client for Omnious backend.
 * Makes tRPC-compatible HTTP calls using native fetch.
 */
export class OmniousApiClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  /**
   * Call a tRPC mutation (POST).
   * tRPC HTTP protocol: POST /trpc/{procedure} with JSON body.
   */
  async mutate<T>(procedure: string, input: unknown): Promise<T> {
    const url = `${this.baseUrl}/trpc/${procedure}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // tRPC v11 + superjson: body must be wrapped as { json: <input> }
      body: JSON.stringify({ json: input }),
    });

    const json = (await res.json()) as {
      result?: { data: { json: T } };
      error?: { message: string; data?: { code: string } };
    };

    if (!res.ok || json.error) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      const code = json.error?.data?.code ?? 'INTERNAL_SERVER_ERROR';
      throw new ApiError(msg, res.status, code);
    }

    // tRPC v11 + superjson: unwrap { json: <data> } envelope
    return json.result!.data.json;
  }

  /**
   * Call a tRPC query (GET).
   * tRPC HTTP protocol: GET /trpc/{procedure}?input={json}
   */
  async query<T>(procedure: string, input: unknown): Promise<T> {
    // tRPC v11 + superjson: input must be wrapped as { json: <input> }
    const encoded = encodeURIComponent(JSON.stringify({ json: input }));
    const url = `${this.baseUrl}/trpc/${procedure}?input=${encoded}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const json = (await res.json()) as {
      result?: { data: { json: T } };
      error?: { message: string; data?: { code: string } };
    };

    if (!res.ok || json.error) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      const code = json.error?.data?.code ?? 'INTERNAL_SERVER_ERROR';
      throw new ApiError(msg, res.status, code);
    }

    // tRPC v11 + superjson: unwrap { json: <data> } envelope
    return json.result!.data.json;
  }

  /** Validate API key and get project info */
  async validateKey(): Promise<{ project_id: string; project_name: string }> {
    return this.mutate('graph.pushFromCLI', {
      projectApiKey: this.apiKey,
      nodes: [],
      edges: [],
      dry_run: true,
    });
  }

  /** Push nodes and edges to the backend */
  async pushGraph(
    nodes: OIRNode[],
    edges: OIREdge[],
    gitContext?: {
      commit_hash?: string;
      branch?: string;
      author_email?: string;
      commit_message?: string;
    },
    indexHash?: string,
  ): Promise<PushResult> {
    return this.mutate('graph.pushFromCLI', {
      projectApiKey: this.apiKey,
      nodes: nodes.map((n) => ({
        oir_id: n.oir_id,
        type: n.type,
        name: n.name,
        file_path: n.file_path,
        line_start: n.line_start,
        line_end: n.line_end,
        signature: n.signature,
        doc_comment: n.doc_comment,
        metadata: n.metadata,
        content_hash: n.content_hash,
      })),
      edges: edges.map((e) => ({
        source_oir_id: e.source_oir_id,
        target_oir_id: e.target_oir_id,
        type: e.type,
        metadata: e.metadata,
      })),
      git_context: gitContext,
      index_hash: indexHash,
    });
  }

  /** Get project status/stats */
  async getProjectStatus(): Promise<ProjectStatus> {
    return this.query('graph.getProjectStatusFromCLI', {
      projectApiKey: this.apiKey,
    });
  }

  /** Health check */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/trpc/health.check`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
