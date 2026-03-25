#!/usr/bin/env node
/**
 * Comprehensive test suite for smart-commit-changelog.
 * Tests analyzer + generator logic, then MCP endpoint via HTTP.
 */

const { parseDiff, categorizeDiff, detectBreakingChanges } = require('./src/analyzer');
const {
  generateCommitMessage,
  generateChangelog,
  generateReleaseNotes,
  diffSummary,
  parseConventionalCommit,
} = require('./src/generator');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.log(`  \u2717 FAIL: ${label}`);
  }
}

// ─── Sample diffs ────────────────────────────────────────────────────

const SAMPLE_FEAT_DIFF = `diff --git a/src/utils.js b/src/utils.js
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/utils.js
@@ -0,0 +1,15 @@
+const express = require('express');
+
+function formatDate(date) {
+  return date.toISOString().split('T')[0];
+}
+
+function slugify(text) {
+  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
+}
+
+module.exports = { formatDate, slugify };
`;

const SAMPLE_FIX_DIFF = `diff --git a/src/handler.js b/src/handler.js
index 1234567..abcdef1 100644
--- a/src/handler.js
+++ b/src/handler.js
@@ -10,6 +10,10 @@ function processRequest(req) {
-  const data = req.body;
+  const data = req.body;
+  if (!data) {
+    throw new Error('Request body is required');
+  }
+  if (!data.id) {
+    throw new Error('Missing required field: id');
+  }
   return transform(data);
`;

const SAMPLE_BREAKING_DIFF = `diff --git a/src/api.js b/src/api.js
index 1234567..abcdef1 100644
--- a/src/api.js
+++ b/src/api.js
@@ -5,10 +5,8 @@
-export function createUser(name, email, age) {
-  return { name, email, age };
-}
-
-export function deleteUser(id) {
-  return db.delete(id);
+export function createUser(name, email) {
+  return { name, email };
 }
`;

const SAMPLE_DOCS_DIFF = `diff --git a/README.md b/README.md
index 1234567..abcdef1 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,5 @@
 # Project
-Old description
+New description with more detail.
+
+## Installation
+Run \`npm install\` to get started.
`;

const SAMPLE_MULTI_DIFF = `diff --git a/src/server.js b/src/server.js
index 1234567..abcdef1 100644
--- a/src/server.js
+++ b/src/server.js
@@ -1,3 +1,5 @@
+const cors = require('cors');
 const express = require('express');
+app.use(cors());
 app.listen(3000);
diff --git a/src/routes.js b/src/routes.js
new file mode 100644
index 0000000..abcdef2
--- /dev/null
+++ b/src/routes.js
@@ -0,0 +1,8 @@
+const router = require('express').Router();
+
+router.get('/health', (req, res) => {
+  res.json({ ok: true });
+});
+
+module.exports = router;
`;

const SAMPLE_TEST_DIFF = `diff --git a/tests/utils.test.js b/tests/utils.test.js
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/tests/utils.test.js
@@ -0,0 +1,10 @@
+const { formatDate } = require('../src/utils');
+
+describe('formatDate', () => {
+  test('formats date correctly', () => {
+    const d = new Date('2024-01-15T00:00:00Z');
+    expect(formatDate(d)).toBe('2024-01-15');
+  });
+});
`;

const SAMPLE_GIT_LOG = `abc1234|feat(auth): add JWT authentication|Alice|2024-03-15 10:00:00|HEAD -> main, tag: v1.2.0
def5678|fix(api): handle null response body|Bob|2024-03-14 09:00:00|
ghi9012|refactor: extract validation logic|Alice|2024-03-13 08:00:00|
jkl3456|docs: update API documentation|Carol|2024-03-12 07:00:00|
mno7890|feat(db): add connection pooling|Bob|2024-03-11 06:00:00|tag: v1.1.0
pqr1234|fix: resolve memory leak in worker|Alice|2024-03-10 05:00:00|
stu5678|chore: update dependencies|Carol|2024-03-09 04:00:00|tag: v1.0.0`;


// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== ANALYZER TESTS ===\n');

// parseDiff
console.log('parseDiff:');
{
  const result = parseDiff(SAMPLE_FEAT_DIFF);
  assert(result.files.length === 1, 'parses single file');
  assert(result.files[0].path === 'src/utils.js', 'correct file path');
  assert(result.files[0].status === 'added', 'detects new file');
  assert(result.files[0].additions > 0, 'counts additions');
  assert(result.stats.filesChanged === 1, 'stats: 1 file changed');
}

{
  const result = parseDiff(SAMPLE_MULTI_DIFF);
  assert(result.files.length === 2, 'parses multiple files');
  assert(result.stats.filesChanged === 2, 'stats: 2 files changed');
}

{
  const result = parseDiff('');
  assert(result.files.length === 0, 'handles empty diff');
}

{
  const result = parseDiff(null);
  assert(result.files.length === 0, 'handles null diff');
}

// categorizeDiff
console.log('\ncategorizeDiff:');
{
  const parsed = parseDiff(SAMPLE_FEAT_DIFF);
  const result = categorizeDiff(parsed);
  assert(result.primaryCategory === 'feat', 'new source file → feat');
  assert(result.scope === 'utils', 'scope from single file');
}

{
  const parsed = parseDiff(SAMPLE_DOCS_DIFF);
  const result = categorizeDiff(parsed);
  assert(result.primaryCategory === 'docs', 'README.md → docs');
}

{
  const parsed = parseDiff(SAMPLE_TEST_DIFF);
  const result = categorizeDiff(parsed);
  assert(result.primaryCategory === 'test', 'test file → test');
}

{
  const parsed = parseDiff(SAMPLE_FIX_DIFF);
  const result = categorizeDiff(parsed);
  assert(result.primaryCategory === 'fix', 'error handling addition → fix');
}

{
  const parsed = parseDiff(SAMPLE_MULTI_DIFF);
  const result = categorizeDiff(parsed);
  assert(result.scope === 'src', 'common dir as scope');
}

// detectBreakingChanges
console.log('\ndetectBreakingChanges:');
{
  const parsed = parseDiff(SAMPLE_BREAKING_DIFF);
  const result = detectBreakingChanges(parsed);
  assert(result.hasBreakingChanges === true, 'detects breaking changes');
  assert(result.changes.length > 0, 'has change details');
  const removed = result.changes.find(c => c.type === 'export_removed' || c.type === 'function_removed');
  assert(!!removed, 'detects removed function/export');
  const sigChanged = result.changes.find(c => c.type === 'signature_changed');
  assert(!!sigChanged, 'detects signature change');
}

{
  const parsed = parseDiff(SAMPLE_FEAT_DIFF);
  const result = detectBreakingChanges(parsed);
  assert(result.hasBreakingChanges === false, 'no breaking in new file');
}


// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== GENERATOR TESTS ===\n');

// generateCommitMessage
console.log('generateCommitMessage:');
{
  const result = generateCommitMessage(SAMPLE_FEAT_DIFF);
  assert(result.type === 'feat', 'type is feat');
  assert(result.headline.startsWith('feat'), 'headline starts with feat');
  assert(result.message.length > 0, 'message is not empty');
  assert(result.breaking === false, 'no breaking flag');
}

{
  const result = generateCommitMessage(SAMPLE_FIX_DIFF);
  assert(result.type === 'fix', 'type is fix');
}

{
  const result = generateCommitMessage(SAMPLE_BREAKING_DIFF);
  assert(result.breaking === true, 'breaking flag set');
  assert(result.headline.includes('!'), 'headline has ! for breaking');
  assert(result.message.includes('BREAKING CHANGE'), 'footer has BREAKING CHANGE');
}

{
  const result = generateCommitMessage(SAMPLE_FEAT_DIFF, { type: 'chore', scope: 'build' });
  assert(result.type === 'chore', 'override type works');
  assert(result.scope === 'build', 'override scope works');
}

// parseConventionalCommit
console.log('\nparseConventionalCommit:');
{
  const r = parseConventionalCommit('feat(auth): add login');
  assert(r.type === 'feat', 'parses type');
  assert(r.scope === 'auth', 'parses scope');
  assert(r.subject === 'add login', 'parses subject');
  assert(r.breaking === false, 'not breaking');
}
{
  const r = parseConventionalCommit('fix!: critical patch');
  assert(r.type === 'fix', 'parses fix type');
  assert(r.breaking === true, 'detects ! breaking');
}
{
  const r = parseConventionalCommit('Add new feature for users');
  assert(r.type === 'feat', 'heuristic: Add → feat');
}

// generateChangelog
console.log('\ngenerateChangelog:');
{
  const result = generateChangelog(SAMPLE_GIT_LOG, { repoName: 'test-repo' });
  assert(result.includes('# Changelog'), 'has changelog header');
  assert(result.includes('test-repo'), 'has repo name');
  assert(result.includes('Features'), 'has Features section');
  assert(result.includes('Bug Fixes'), 'has Bug Fixes section');
  assert(result.includes('add JWT authentication'), 'includes commit subject');
  assert(result.includes('1.2.0') || result.includes('v1.2.0'), 'includes version tag');
}

{
  const result = generateChangelog('');
  assert(result.includes('No commits found'), 'handles empty log');
}

// generateReleaseNotes
console.log('\ngenerateReleaseNotes:');
{
  const log = `abc1234|feat(auth): add JWT authentication|Alice|2024-03-15|
def5678|fix(api): handle null response|Bob|2024-03-14|
ghi9012|refactor: extract validation|Alice|2024-03-13|`;
  const result = generateReleaseNotes(log, { version: '2.0.0', repoName: 'my-app' });
  assert(result.includes('v2.0.0'), 'has version');
  assert(result.includes('my-app'), 'has repo name');
  assert(result.includes('New Features'), 'has features section');
  assert(result.includes('Bug Fixes'), 'has fixes section');
  assert(result.includes('Contributors'), 'has contributors');
  assert(result.includes('Alice'), 'lists contributors');
  assert(result.includes('3 commit(s)'), 'commit count');
}

// diffSummary
console.log('\ndiffSummary:');
{
  const result = diffSummary(SAMPLE_MULTI_DIFF);
  assert(result.stats.filesChanged === 2, 'correct file count');
  assert(result.primaryCategory !== undefined, 'has primary category');
  assert(Array.isArray(result.files), 'files is array');
  assert(result.files.length === 2, 'all files listed');
}


// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== MCP SERVER TESTS ===\n');

const app = require('./src/server');
const http = require('http');

async function testMCP() {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  async function rpc(method, params = {}) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost', port, path: '/mcp', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async function rest(path, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost', port, path, method: payload ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body || '') },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      if (payload) req.write(body);
      req.end();
    });
  }

  // MCP initialize
  {
    const r = await rpc('initialize');
    assert(r.result?.serverInfo?.name === 'smart-commit-changelog', 'MCP initialize returns server info');
    assert(r.result?.capabilities?.tools, 'MCP has tools capability');
  }

  // MCP tools/list
  {
    const r = await rpc('tools/list');
    assert(r.result?.tools?.length === 6, 'MCP lists 6 tools');
    const names = r.result.tools.map(t => t.name);
    assert(names.includes('analyze_diff'), 'has analyze_diff tool');
    assert(names.includes('generate_commit'), 'has generate_commit tool');
    assert(names.includes('generate_changelog'), 'has generate_changelog tool');
    assert(names.includes('generate_release_notes'), 'has generate_release_notes tool');
    assert(names.includes('detect_breaking'), 'has detect_breaking tool');
    assert(names.includes('diff_summary'), 'has diff_summary tool');
  }

  // MCP tools/call — analyze_diff
  {
    const r = await rpc('tools/call', { name: 'analyze_diff', arguments: { diff: SAMPLE_FEAT_DIFF } });
    assert(!r.error, 'analyze_diff no error');
    const content = JSON.parse(r.result.content[0].text);
    assert(content.primaryCategory === 'feat', 'MCP analyze_diff returns feat');
  }

  // MCP tools/call — generate_commit
  {
    const r = await rpc('tools/call', { name: 'generate_commit', arguments: { diff: SAMPLE_FIX_DIFF } });
    assert(!r.error, 'generate_commit no error');
    const content = JSON.parse(r.result.content[0].text);
    assert(content.type === 'fix', 'MCP generate_commit returns fix');
    assert(content.message.length > 0, 'MCP generate_commit has message');
  }

  // MCP tools/call — generate_changelog
  {
    const r = await rpc('tools/call', { name: 'generate_changelog', arguments: { git_log: SAMPLE_GIT_LOG, repo_name: 'test' } });
    assert(!r.error, 'generate_changelog no error');
    const text = r.result.content[0].text;
    assert(text.includes('Changelog'), 'MCP changelog has header');
  }

  // MCP tools/call — detect_breaking
  {
    const r = await rpc('tools/call', { name: 'detect_breaking', arguments: { diff: SAMPLE_BREAKING_DIFF } });
    assert(!r.error, 'detect_breaking no error');
    const content = JSON.parse(r.result.content[0].text);
    assert(content.hasBreakingChanges === true, 'MCP detects breaking');
  }

  // MCP tools/call — diff_summary
  {
    const r = await rpc('tools/call', { name: 'diff_summary', arguments: { diff: SAMPLE_MULTI_DIFF } });
    assert(!r.error, 'diff_summary no error');
    const content = JSON.parse(r.result.content[0].text);
    assert(content.stats.filesChanged === 2, 'MCP summary has correct count');
  }

  // MCP error — unknown tool
  {
    const r = await rpc('tools/call', { name: 'nonexistent', arguments: {} });
    assert(!!r.error, 'MCP returns error for unknown tool');
  }

  // REST /health
  {
    const r = await rest('/health');
    assert(r.status === 'ok', 'REST health ok');
    assert(r.tools === 6, 'REST health shows 6 tools');
  }

  // REST /api/analyze_diff
  {
    const r = await rest('/api/analyze_diff', { diff: SAMPLE_FEAT_DIFF });
    assert(r.ok === true, 'REST analyze_diff ok');
    assert(r.result.primaryCategory === 'feat', 'REST analyze_diff returns feat');
  }

  server.close();
}

testMCP().then(() => {
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
