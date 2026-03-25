# Smart Commit Changelog

[![npm](https://img.shields.io/npm/v/@lazymac/smart-commit-changelog)](https://www.npmjs.com/package/@lazymac/smart-commit-changelog)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Git diff in, semantic commit messages out.** Analyzes your changes and generates Conventional Commits messages and changelogs. Zero external APIs -- runs entirely locally.

## Why

Writing good commit messages is tedious. Maintaining changelogs is worse. This tool reads your git diff and generates both -- following Conventional Commits spec, detecting breaking changes, and grouping by type.

## Install

```bash
npm i @lazymac/smart-commit-changelog
```

## Quick Start

### As REST API
```bash
npm start
# Server runs on http://localhost:3000
```

### As MCP Server
```json
{
  "mcpServers": {
    "smart-commit-changelog": {
      "command": "node",
      "args": ["node_modules/@lazymac/smart-commit-changelog/src/main.js"]
    }
  }
}
```

## API Endpoints

### `POST /commit-message`
Generate a commit message from a git diff.

```bash
curl -X POST http://localhost:3000/commit-message \
  -H "Content-Type: application/json" \
  -d '{"diff": "diff --git a/src/auth.js..."}'
```

**Response:**
```json
{
  "message": "feat(auth): add JWT refresh token rotation",
  "type": "feat",
  "scope": "auth",
  "breaking": false,
  "body": "Implement automatic refresh token rotation to improve security. Old refresh tokens are invalidated after use."
}
```

### `POST /changelog`
Generate a changelog from multiple commits.

```bash
curl -X POST http://localhost:3000/changelog \
  -H "Content-Type: application/json" \
  -d '{"commits": [...]}'
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `generate_commit` | Semantic commit message from diff |
| `generate_changelog` | Changelog from commit history |
| `analyze_diff` | Categorize changes (feat/fix/refactor) |
| `detect_breaking` | Detect breaking changes |
| `format_release` | Format release notes |
| `suggest_version` | Suggest semver bump |

## Links

- [GitHub](https://github.com/lazymac2x/smart-commit-changelog)
- [npm](https://www.npmjs.com/package/@lazymac/smart-commit-changelog)
- [All 29 Tools](https://lazymac2x.github.io/lazymac-api-store/)

## License

MIT
