import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OmniousClient } from './client.js';

// ── Configuration ──

const API_URL = process.env['OMNIOUS_API_URL'] ?? 'http://localhost:4000';
const API_KEY = process.env['OMNIOUS_API_KEY'] ?? '';

if (!API_KEY) {
  console.error('OMNIOUS_API_KEY environment variable is required');
  process.exit(1);
}

const client = new OmniousClient(API_URL, API_KEY);

// Resolve the project ID once at startup
let projectId: string | null = null;
let projectName: string | null = null;

async function ensureProject(): Promise<{ id: string; name: string }> {
  if (projectId && projectName) return { id: projectId, name: projectName };
  const status = await client.getProjectStatus();
  projectId = status.id;
  projectName = status.name;
  return { id: projectId, name: projectName };
}

// ── MCP Server ──

const server = new McpServer({
  name: 'omnious',
  version: '0.1.0',
});

// ── Tool: query_graph ──

server.tool(
  'query_graph',
  'Query the code graph using natural language. Returns relevant code nodes, their relationships, and an AI-generated explanation. Use this to explore codebases, understand architecture, find dependencies, or answer questions about code.',
  {
    query: z.string().describe('Natural language question about the codebase (e.g., "How does the auth flow work?" or "What calls the payment service?")'),
    context_node_ids: z.array(z.string()).optional().describe('Optional node IDs to focus the search around'),
  },
  async ({ query, context_node_ids }) => {
    await ensureProject();
    const result = await client.queryGraph(query, context_node_ids);

    const nodeList = result.nodes
      .map((n) => `- **${n.name}** (${n.type}) — \`${n.file_path}\`${n.signature ? `\n  Signature: \`${n.signature}\`` : ''}${n.code_body ? `\n  \`\`\`\n${n.code_body.slice(0, 500)}\n  \`\`\`` : ''}`)
      .join('\n');

    const edgeList = result.edges
      .map((e) => `- ${e.source} → ${e.target} (${e.type})`)
      .join('\n');

    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `## Graph Query: "${query}"`,
            '',
            result.explanation,
            '',
            `### Nodes Found (${result.nodes.length})`,
            nodeList || '_No nodes found_',
            '',
            `### Relationships (${result.edges.length})`,
            edgeList || '_No relationships_',
          ].join('\n'),
        },
      ],
    };
  },
);

// ── Tool: get_node_details ──

server.tool(
  'get_node_details',
  'Get detailed information about a specific code node including its source code, connections, and metadata. Use node names or search to find nodes first.',
  {
    search: z.string().describe('Search term to find the node (function name, class name, or file path)'),
    limit: z.number().optional().default(5).describe('Maximum number of results'),
  },
  async ({ search, limit }) => {
    await ensureProject();
    const results = await client.searchNodes(search, limit);

    if (!results.nodes.length) {
      return {
        content: [{ type: 'text' as const, text: `No nodes found matching "${search}"` }],
      };
    }

    const sections = results.nodes.map((n) => [
      `### ${n.name}`,
      `- **Type**: ${n.type}`,
      `- **File**: \`${n.file_path}\`${n.line_start ? `:${n.line_start}` : ''}${n.line_end ? `-${n.line_end}` : ''}`,
      n.signature ? `- **Signature**: \`${n.signature}\`` : '',
      n.doc_comment ? `- **Documentation**: ${n.doc_comment}` : '',
      n.code_body ? `\n\`\`\`typescript\n${n.code_body}\n\`\`\`` : '',
    ].filter(Boolean).join('\n'));

    return {
      content: [{
        type: 'text' as const,
        text: sections.join('\n\n---\n\n'),
      }],
    };
  },
);

// ── Tool: get_architecture_overview ──

server.tool(
  'get_architecture_overview',
  'Get a high-level overview of the project architecture including structure, patterns, conventions, and key entry points. Great for onboarding or understanding a new codebase.',
  {},
  async () => {
    await ensureProject();

    const [status, overview] = await Promise.all([
      client.getProjectStatus(),
      client.getOverview().catch(() => null),
    ]);

    const parts = [
      `# ${status.name} — Architecture Overview`,
      '',
      `| Metric | Count |`,
      `|--------|-------|`,
      `| Code Nodes | ${status.node_count} |`,
      `| Relationships | ${status.edge_count} |`,
      `| Execution Traces | ${status.trace_count} |`,
      `| Errors | ${status.error_count} |`,
      `| Last Indexed | ${status.last_indexed_at ?? 'Never'} |`,
    ];

    if (overview?.explanation) {
      parts.push('', '## AI-Generated Overview', '', overview.explanation);
    }

    return {
      content: [{ type: 'text' as const, text: parts.join('\n') }],
    };
  },
);

// ── Tool: explain_error ──

server.tool(
  'explain_error',
  'Analyze a runtime error using code graph context. Provide the error message and stack trace to get root cause analysis, related code paths, and fix suggestions.',
  {
    error_message: z.string().describe('The error message'),
    error_stack: z.string().optional().describe('Full stack trace'),
    file_path: z.string().optional().describe('File where the error occurred'),
  },
  async ({ error_message, error_stack, file_path }) => {
    await ensureProject();

    // Use graph query to find relevant code context
    const contextQuery = [
      `Explain this error and suggest a fix:`,
      `Error: ${error_message}`,
      error_stack ? `Stack trace:\n${error_stack.slice(0, 1000)}` : '',
      file_path ? `File: ${file_path}` : '',
    ].filter(Boolean).join('\n');

    const result = await client.queryGraph(contextQuery);

    const nodeContext = result.nodes
      .slice(0, 5)
      .map((n) => `- \`${n.file_path}\` — **${n.name}** (${n.type})`)
      .join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: [
          `## Error Analysis`,
          '',
          `**Error**: ${error_message}`,
          '',
          result.explanation,
          '',
          `### Related Code`,
          nodeContext || '_No related code found_',
        ].join('\n'),
      }],
    };
  },
);

// ── Tool: suggest_refactor ──

server.tool(
  'suggest_refactor',
  'Get AI-powered refactoring suggestions for a specific area of the codebase. Analyzes dependencies, patterns, and code quality to suggest improvements.',
  {
    target: z.string().describe('What to refactor — a file path, function name, module name, or description (e.g., "auth module" or "src/services/payment.ts")'),
    goal: z.string().optional().describe('Specific refactoring goal (e.g., "reduce coupling", "improve testability", "extract shared logic")'),
  },
  async ({ target, goal }) => {
    await ensureProject();

    const query = [
      `Analyze the code around "${target}" and suggest refactoring improvements.`,
      goal ? `Focus on: ${goal}` : '',
      'Consider: dependency structure, coupling, cohesion, naming, patterns used, and potential simplifications.',
    ].filter(Boolean).join(' ');

    const result = await client.queryGraph(query);

    const affectedNodes = result.nodes
      .map((n) => `- \`${n.file_path}\` — **${n.name}** (${n.type})`)
      .join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: [
          `## Refactoring Suggestions: ${target}`,
          goal ? `**Goal**: ${goal}` : '',
          '',
          result.explanation,
          '',
          `### Affected Code (${result.nodes.length} nodes)`,
          affectedNodes || '_No nodes found_',
          '',
          `### Dependency Graph (${result.edges.length} relationships)`,
          result.edges.slice(0, 15)
            .map((e) => `- ${e.source} → ${e.target} (${e.type})`)
            .join('\n') || '_No relationships_',
        ].filter(Boolean).join('\n'),
      }],
    };
  },
);

// ── Start Server ──

// ── Tool: omnious_recall ──

server.tool(
  'omnious_recall',
  'Search the persistent memory palace for this project. Returns relevant past decisions, debugging sessions, discoveries, and architectural choices. Use this before answering questions that likely have historical context — "why was X done this way?", "what did we decide about Y?", "has this bug appeared before?"',
  {
    query: z.string().describe('What to look up in project memory (e.g., "auth migration decision", "why we chose Postgres", "past debugging of this error")'),
  },
  async ({ query }) => {
    const { id: pId } = await ensureProject();
    const results = await client.searchMemory(pId, query);
    return {
      content: [{
        type: 'text' as const,
        text: results.results || '_No relevant memories found for this query._',
      }],
    };
  },
);

// ── Tool: omnious_store_insight ──

server.tool(
  'omnious_store_insight',
  'Permanently store an important finding, decision, or discovery into the project memory palace. Use this when you observe something notable: an architectural pattern, a bug root cause, a team decision, or a "why" that would help future conversations.',
  {
    content: z.string().describe('The insight to store verbatim — be specific and include enough context to be useful in isolation.'),
    hall: z.enum(['hall_facts', 'hall_events', 'hall_discoveries', 'hall_preferences', 'hall_advice'])
      .default('hall_discoveries')
      .describe('Memory type: facts=decisions, events=debugging/milestones, discoveries=new insights, preferences=habits/opinions, advice=recommendations'),
    room: z.string().default('room_general').describe('Room within the hall — a named concept like "auth-migration", "ci-pipeline", or "rate-limiting"'),
  },
  async ({ content, hall, room }) => {
    const { id: pId } = await ensureProject();
    await client.storeInsight(pId, content, hall, room);
    return {
      content: [{
        type: 'text' as const,
        text: `Stored in \`${hall}/${room}\`. This will be recalled in future relevant conversations.`,
      }],
    };
  },
);

// ── Tool: omnious_project_context ──

server.tool(
  'omnious_project_context',
  'Load the critical memory context for this project (Layer 0 + Layer 1 of the memory stack — ~170 tokens). Gives the AI a snapshot of who works on this project, the main tech decisions, and current priorities. Call this at the start of a new session.',
  {},
  async () => {
    const { id: pId } = await ensureProject();
    const ctx = await client.getMemoryContext(pId);
    return {
      content: [{
        type: 'text' as const,
        text: ctx.context || '_No memory context available yet. The project memory will grow as you use Omnious._',
      }],
    };
  },
);

// ── Tool: omnious_knowledge_timeline ──

server.tool(
  'omnious_knowledge_timeline',
  'Get the temporal history of a specific entity — a person, module, feature, or concept — as tracked in the project knowledge graph. Returns a chronological record of decisions and status changes.',
  {
    entity: z.string().describe('Entity to look up (e.g., "AuthService", "Redis cache", "deploy pipeline", a teammate\'s name)'),
  },
  async ({ entity }) => {
    const { id: pId } = await ensureProject();
    const { timeline } = await client.getKnowledgeTimeline(pId, entity);

    const text = Array.isArray(timeline) && timeline.length > 0
      ? timeline.map((t) => `- ${JSON.stringify(t)}`).join('\n')
      : `_No timeline entries found for "${entity}"._`;

    return {
      content: [{ type: 'text' as const, text: `## Timeline: ${entity}\n\n${text}` }],
    };
  },
);

// ── Start Server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
