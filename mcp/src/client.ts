/**
 * Thin HTTP client for Omnious backend, used by the MCP server.
 * Makes tRPC-compatible HTTP calls using native fetch.
 */
export class OmniousClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async query<T>(procedure: string, input: unknown): Promise<T> {
    const encoded = encodeURIComponent(JSON.stringify({ json: input }));
    const url = `${this.baseUrl}/trpc/${procedure}?input=${encoded}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return this.unwrap<T>(res, procedure);
  }

  async mutate<T>(procedure: string, input: unknown): Promise<T> {
    const url = `${this.baseUrl}/trpc/${procedure}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: input }),
    });
    return this.unwrap<T>(res, procedure);
  }

  /** Query the code graph using natural language — returns nodes, edges, and AI explanation */
  async queryGraph(query: string, contextNodeIds?: string[]): Promise<{
    explanation: string;
    nodes: Array<{ id: string; oir_id: string; name: string; type: string; file_path: string; signature?: string | null; code_body?: string | null }>;
    edges: Array<{ source: string; target: string; type: string }>;
    steps: string[];
  }> {
    return this.mutate('ai.queryGraphFromAPI', {
      projectApiKey: this.apiKey,
      query,
      contextNodeIds,
    });
  }

  /** Search nodes by name */
  async searchNodes(query: string, limit = 5): Promise<{
    nodes: Array<{
      id: string; name: string; type: string; file_path: string;
      line_start: number | null; line_end: number | null;
      signature: string | null; doc_comment: string | null; code_body: string | null;
    }>;
  }> {
    return this.query('ai.searchNodesFromAPI', {
      projectApiKey: this.apiKey,
      query,
      limit,
    });
  }

  /** Get project status */
  async getProjectStatus(): Promise<{
    id: string; name: string; slug: string; workspace_slug: string | null;
    status: string; last_indexed_at: string | null;
    node_count: number; edge_count: number; trace_count: number; error_count: number;
  }> {
    return this.query('graph.getProjectStatusFromCLI', {
      projectApiKey: this.apiKey,
    });
  }

  /** Get AI-generated project overview */
  async getOverview(): Promise<{
    nodes: Array<{ id: string; name: string; type: string; file_path: string }>;
    edges: Array<{ source: string; target: string; type: string }>;
    explanation: string;
    steps: string[];
  }> {
    return this.query('ai.getOverviewFromAPI', {
      projectApiKey: this.apiKey,
    });
  }

  private async unwrap<T>(res: Response, procedure: string): Promise<T> {
    const json = (await res.json()) as {
      result?: { data: { json: T } };
      error?: { message: string; data?: { code: string } };
    };

    if (!res.ok || json.error) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`${procedure}: ${msg}`);
    }

    const data = json.result?.data?.json;
    if (data === undefined) {
      throw new Error(`Unexpected response from ${procedure}`);
    }
    return data;
  }
}
