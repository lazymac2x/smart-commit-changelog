#!/usr/bin/env node
/**
 * smart-commit-changelog — MCP server
 * Git diff → semantic commit messages + changelogs.
 * Express + MCP at POST /mcp. Zero external APIs.
 */

const express = require('express');
const cors = require('cors');
const { parseDiff, categorizeDiff, detectBreakingChanges } = require('./analyzer');
const {
  generateCommitMessage,
  generateChangelog,
  generateReleaseNotes,
  diffSummary,
} = require('./generator');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// ─── Tool definitions ────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'analyze_diff',
    description: 'Parse and categorize a git diff. Returns file-level breakdown with categories (feat/fix/refactor/docs/style/test/chore), line counts, and detected scope.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Raw git diff output (unified diff format)' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'generate_commit',
    description: 'Generate a conventional commit message from a git diff. Detects type, scope, breaking changes, and produces a ready-to-use commit message.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Raw git diff output (unified diff format)' },
        type: { type: 'string', description: 'Override commit type (feat/fix/refactor/docs/style/test/chore)', enum: ['feat', 'fix', 'refactor', 'docs', 'style', 'test', 'chore'] },
        scope: { type: 'string', description: 'Override commit scope' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'generate_changelog',
    description: 'Generate a CHANGELOG.md from git log output. Groups commits by version/tag and type. Expects git log format: "%H|%s|%an|%ai|%D".',
    inputSchema: {
      type: 'object',
      properties: {
        git_log: { type: 'string', description: 'Output of: git log --format="%H|%s|%an|%ai|%D" --no-merges' },
        repo_name: { type: 'string', description: 'Repository name for the header' },
        repo_url: { type: 'string', description: 'Repository URL for commit links' },
      },
      required: ['git_log'],
    },
  },
  {
    name: 'generate_release_notes',
    description: 'Generate human-readable release notes from git log between two refs. Highlights breaking changes, features, and fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        git_log: { type: 'string', description: 'Output of: git log --format="%H|%s|%an|%ai|%D" --no-merges v1.0.0..v2.0.0' },
        version: { type: 'string', description: 'Version string for the release (e.g., "2.0.0")' },
        date: { type: 'string', description: 'Release date (YYYY-MM-DD)' },
        repo_name: { type: 'string', description: 'Repository name' },
        repo_url: { type: 'string', description: 'Repository URL' },
      },
      required: ['git_log'],
    },
  },
  {
    name: 'detect_breaking',
    description: 'Detect breaking changes in a git diff. Checks for removed exports, changed function signatures, deleted public files, removed classes/types, and environment variable changes.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Raw git diff output (unified diff format)' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'diff_summary',
    description: 'Quick summary of a git diff: files changed, lines added/removed, categories, scope, and any breaking changes.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Raw git diff output (unified diff format)' },
      },
      required: ['diff'],
    },
  },
];

// ─── Tool execution ──────────────────────────────────────────────────
function executeTool(name, args) {
  switch (name) {
    case 'analyze_diff': {
      const parsed = parseDiff(args.diff);
      return categorizeDiff(parsed);
    }
    case 'generate_commit': {
      return generateCommitMessage(args.diff, {
        type: args.type,
        scope: args.scope,
      });
    }
    case 'generate_changelog': {
      return generateChangelog(args.git_log, {
        repoName: args.repo_name,
        repoUrl: args.repo_url,
      });
    }
    case 'generate_release_notes': {
      return generateReleaseNotes(args.git_log, {
        version: args.version,
        date: args.date,
        repoName: args.repo_name,
        repoUrl: args.repo_url,
      });
    }
    case 'detect_breaking': {
      const parsed = parseDiff(args.diff);
      return detectBreakingChanges(parsed);
    }
    case 'diff_summary': {
      return diffSummary(args.diff);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP endpoint (JSON-RPC 2.0) ────────────────────────────────────
app.post('/mcp', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC version' } });
  }

  try {
    switch (method) {
      case 'initialize': {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'smart-commit-changelog',
              version: '1.0.0',
              description: 'Git diff → semantic commit messages + changelogs. All local, zero external APIs.',
            },
            capabilities: {
              tools: { listChanged: false },
            },
          },
        });
      }

      case 'tools/list': {
        return res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        });
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        if (!name) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } });
        }

        const tool = TOOLS.find(t => t.name === name);
        if (!tool) {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
        }

        const result = executeTool(name, args || {});
        const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: content }],
          },
        });
      }

      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
    }
  } catch (err) {
    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err.message },
    });
  }
});

// ─── REST endpoints for direct use ───────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', tools: TOOLS.length }));

app.get('/tools', (_req, res) => res.json({ tools: TOOLS }));

app.post('/api/:tool', (req, res) => {
  const { tool } = req.params;
  try {
    const result = executeTool(tool, req.body);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`smart-commit-changelog MCP server running on port ${PORT}`);
    console.log(`  MCP endpoint: POST http://localhost:${PORT}/mcp`);
    console.log(`  REST API:     POST http://localhost:${PORT}/api/{tool}`);
    console.log(`  Health:       GET  http://localhost:${PORT}/health`);
    console.log(`  Tools: ${TOOLS.map(t => t.name).join(', ')}`);
  });
}

module.exports = app;
