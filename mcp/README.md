# Omnious MCP Server

The Omnious MCP server exposes your project's code graph to AI coding assistants via the [Model Context Protocol](https://modelcontextprotocol.io/). It lets tools like GitHub Copilot, Claude Desktop, and Cursor query your codebase architecture, trace execution paths, investigate errors, and build memory of insights — all grounded in your actual code.

## Prerequisites

- Node.js 20+
- An Omnious project with an indexed codebase
- Your project's API key (found on the project overview page)

## Tools

| Tool | Description |
|------|-------------|
| `query_graph` | Natural language search over your code graph |
| `get_node_details` | Get full details for a specific code node by ID |
| `get_architecture_overview` | High-level summary of the codebase structure |
| `explain_error` | Analyse a recorded error with AI context from the graph |
| `suggest_refactor` | Get refactoring suggestions for a node or cluster |
| `omnious_recall` | Search past AI insights stored for this project |
| `omnious_store_insight` | Save a new insight to the project's memory |
| `omnious_project_context` | Get the AI-generated project profile |
| `omnious_knowledge_timeline` | Browse insights by date |

## Setup

### 1. Build the server

```bash
cd mcp
npm install
npm run build
```

### 2. Set environment variables

```bash
export OMNIOUS_API_KEY="<your-project-api-key>"
export OMNIOUS_API_URL="https://api.omnious.dev"  # or http://localhost:4000 for self-hosted
```

---

### VS Code (GitHub Copilot)

Add the following to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "omnious": {
        "type": "stdio",
        "command": "node",
        "args": ["/absolute/path/to/omnious/mcp/dist/index.js"],
        "env": {
          "OMNIOUS_API_KEY": "<your-project-api-key>",
          "OMNIOUS_API_URL": "https://api.omnious.dev"
        }
      }
    }
  }
}
```

Or, if you have published the package, use `npx`:

```json
{
  "mcp": {
    "servers": {
      "omnious": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@omnious/mcp"],
        "env": {
          "OMNIOUS_API_KEY": "<your-project-api-key>",
          "OMNIOUS_API_URL": "https://api.omnious.dev"
        }
      }
    }
  }
}
```

---

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "omnious": {
      "command": "node",
      "args": ["/absolute/path/to/omnious/mcp/dist/index.js"],
      "env": {
        "OMNIOUS_API_KEY": "<your-project-api-key>",
        "OMNIOUS_API_URL": "https://api.omnious.dev"
      }
    }
  }
}
```

---

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "omnious": {
      "command": "node",
      "args": ["/absolute/path/to/omnious/mcp/dist/index.js"],
      "env": {
        "OMNIOUS_API_KEY": "<your-project-api-key>",
        "OMNIOUS_API_URL": "https://api.omnious.dev"
      }
    }
  }
}
```

---

## Self-hosted

If you are running Omnious locally, set `OMNIOUS_API_URL` to your backend address (default: `http://localhost:4000`).

## License

MIT
