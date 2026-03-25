/**
 * analyzer.js — Diff parsing, change categorization, breaking change detection.
 * Entirely local, zero external API calls.
 */

// ─── File-extension to category mapping ───────────────────────────────
const EXT_CATEGORY = {
  // docs
  '.md': 'docs', '.txt': 'docs', '.rst': 'docs', '.adoc': 'docs',
  // style
  '.css': 'style', '.scss': 'style', '.sass': 'style', '.less': 'style',
  '.styl': 'style', '.styled': 'style',
  // test
  '.test.js': 'test', '.test.ts': 'test', '.test.tsx': 'test',
  '.spec.js': 'test', '.spec.ts': 'test', '.spec.tsx': 'test',
  '.test.py': 'test', '_test.go': 'test', '_test.rb': 'test',
  // config / chore
  '.yml': 'chore', '.yaml': 'chore', '.toml': 'chore',
  '.editorconfig': 'chore', '.eslintrc': 'chore', '.prettierrc': 'chore',
};

const CHORE_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', '.dockerignore', '.env.example', 'Dockerfile',
  'docker-compose.yml', 'docker-compose.yaml', 'Makefile',
  'tsconfig.json', 'babel.config.js', 'jest.config.js',
  '.github/workflows', 'renovate.json', '.npmrc',
]);

const TEST_DIRS = ['test/', 'tests/', '__tests__/', 'spec/', 'specs/', 'e2e/', 'cypress/'];
const DOC_DIRS = ['docs/', 'doc/', 'documentation/'];

// ─── Parse unified diff ───────────────────────────────────────────────
function parseDiff(diffText) {
  if (!diffText || typeof diffText !== 'string') {
    return { files: [], stats: { filesChanged: 0, additions: 0, deletions: 0 } };
  }

  const files = [];
  // Split on "diff --git" keeping the delimiter
  const chunks = diffText.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const file = parseFileChunk(chunk);
    if (file) files.push(file);
  }

  const stats = {
    filesChanged: files.length,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
  };

  return { files, stats };
}

function parseFileChunk(chunk) {
  const lines = chunk.split('\n');
  if (lines.length === 0) return null;

  // Extract file paths  — "a/path b/path"
  const headerMatch = lines[0].match(/a\/(.+?)\s+b\/(.+)/);
  const oldPath = headerMatch ? headerMatch[1] : null;
  const newPath = headerMatch ? headerMatch[2] : null;
  const filePath = newPath || oldPath || 'unknown';

  // Detect rename / new / deleted
  const isNew = chunk.includes('new file mode');
  const isDeleted = chunk.includes('deleted file mode');
  const isRename = chunk.includes('rename from') || (oldPath !== newPath && oldPath && newPath && !isNew && !isDeleted);
  const isBinary = chunk.includes('Binary files');

  // Count additions / deletions from hunk lines
  let additions = 0;
  let deletions = 0;
  const addedLines = [];
  const removedLines = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
      addedLines.push(line.slice(1));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
      removedLines.push(line.slice(1));
    }
  }

  return {
    path: filePath,
    oldPath: isRename ? oldPath : null,
    status: isNew ? 'added' : isDeleted ? 'deleted' : isRename ? 'renamed' : 'modified',
    isBinary,
    additions,
    deletions,
    addedLines,
    removedLines,
  };
}

// ─── Categorize a file change ─────────────────────────────────────────
function categorizeFile(file) {
  const p = file.path.toLowerCase();

  // Test files / dirs
  if (TEST_DIRS.some(d => p.includes(d))) return 'test';
  for (const ext of ['.test.js','.test.ts','.test.tsx','.spec.js','.spec.ts','.spec.tsx','_test.go','_test.rb','.test.py']) {
    if (p.endsWith(ext)) return 'test';
  }

  // Doc dirs / files
  if (DOC_DIRS.some(d => p.includes(d))) return 'docs';
  if (p === 'readme.md' || p === 'changelog.md' || p === 'license' || p === 'license.md') return 'docs';

  // Chore files
  for (const cf of CHORE_FILES) {
    if (p === cf.toLowerCase() || p.endsWith('/' + cf.toLowerCase())) return 'chore';
  }
  if (p.includes('.github/') || p.includes('.circleci/') || p.includes('.gitlab-ci')) return 'chore';

  // Style files
  for (const ext of ['.css', '.scss', '.sass', '.less', '.styl']) {
    if (p.endsWith(ext)) return 'style';
  }

  // Markdown/docs by extension
  if (p.endsWith('.md') || p.endsWith('.rst') || p.endsWith('.adoc')) return 'docs';

  // Config by extension
  if (p.endsWith('.yml') || p.endsWith('.yaml') || p.endsWith('.toml')) return 'chore';

  // Content-based heuristics for source files
  return categorizeByContent(file);
}

function categorizeByContent(file) {
  const added = file.addedLines.join('\n');
  const removed = file.removedLines.join('\n');
  const combined = added + '\n' + removed;

  // Pure refactor signals: mostly renames, moves, restructuring with no new functionality
  const refactorSignals = [
    /\brefactor\b/i, /\brename\b/i, /\brestructur/i, /\bextract\b/i,
    /\bmove\b/i, /\bcleanup\b/i, /\bclean up\b/i, /\bsimplif/i,
  ];

  // Fix signals
  const fixSignals = [
    /\bfix\b/i, /\bbug\b/i, /\bpatch\b/i, /\bhotfix\b/i,
    /\bcorrect\b/i, /\bhandle\s+(null|undefined|error|edge)/i,
    /\btry\s*\{/, /\bcatch\s*\(/, /\berror\s+handling/i,
    /!=\s*null/, /!==\s*undefined/, /\?\?/, /\?\./,
    /throw\s+new\s+Error/i, /\bif\s*\(\s*!/,
    /\brequired\b/i, /\bmissing\b/i, /\binvalid\b/i,
  ];

  // Feature signals
  const featSignals = [
    /\bfunction\s+\w+/, /\bclass\s+\w+/, /\bexport\s+(default\s+)?/,
    /\bconst\s+\w+\s*=\s*(async\s+)?\(/, /\bmodule\.exports/,
    /(?<!throw\s+)\bnew\s+(?!Error\b)\w+/, /\bimport\s+/, /\bapp\.(get|post|put|delete|patch)\s*\(/,
    /\brouter\.(get|post|put|delete|patch)\s*\(/,
  ];

  // Count signal matches
  let fixScore = 0, featScore = 0, refactorScore = 0;
  for (const r of fixSignals) if (r.test(combined)) fixScore++;
  for (const r of featSignals) if (r.test(added)) featScore++;
  for (const r of refactorSignals) if (r.test(combined)) refactorScore++;

  // New file with substantial code → likely feat
  if (file.status === 'added' && file.additions > 5) return 'feat';

  // Deleted file → refactor or chore
  if (file.status === 'deleted') return 'refactor';

  // Ratio-based: mostly deletions with some additions → refactor
  if (file.deletions > 0 && file.additions > 0) {
    const ratio = file.additions / file.deletions;
    if (ratio > 0.8 && ratio < 1.2 && refactorScore > 0) return 'refactor';
  }

  if (fixScore > featScore && fixScore > refactorScore) return 'fix';
  if (featScore >= fixScore && featScore > 0) return 'feat';
  if (refactorScore > 0) return 'refactor';

  // Default: if mostly additions → feat, if mostly deletions → refactor, else feat
  if (file.additions > file.deletions * 2) return 'feat';
  if (file.deletions > file.additions * 2) return 'refactor';

  return 'feat';
}

// ─── Scope detection ──────────────────────────────────────────────────
function detectScope(files) {
  if (files.length === 0) return null;
  if (files.length === 1) {
    return scopeFromPath(files[0].path);
  }

  // Find common directory
  const dirs = files.map(f => {
    const parts = f.path.split('/');
    return parts.length > 1 ? parts.slice(0, -1) : [];
  });

  if (dirs.length === 0) return null;

  const common = [];
  for (let i = 0; i < dirs[0].length; i++) {
    if (dirs.every(d => d[i] === dirs[0][i])) {
      common.push(dirs[0][i]);
    } else break;
  }

  if (common.length > 0) {
    // Use the deepest meaningful directory
    const scope = common[common.length - 1];
    if (['src', 'lib', 'app'].includes(scope) && common.length > 1) {
      return common[common.length - 1];
    }
    return scope;
  }

  // If files span multiple top-level dirs, no scope
  const topDirs = new Set(files.map(f => f.path.split('/')[0]));
  if (topDirs.size === 1) return topDirs.values().next().value;

  return null;
}

function scopeFromPath(filePath) {
  const parts = filePath.split('/');
  if (parts.length <= 1) {
    // Root-level file — use filename without extension
    const name = parts[0].replace(/\.[^.]+$/, '');
    return name;
  }
  // Use the first meaningful directory
  if (['src', 'lib', 'app'].includes(parts[0])) {
    if (parts.length > 2) return parts[1];
    // File directly under src/lib/app — use filename as scope
    return parts[1].replace(/\.[^.]+$/, '');
  }
  return parts[0];
}

// ─── Categorize entire diff ──────────────────────────────────────────
function categorizeDiff(parsedDiff) {
  const categorized = parsedDiff.files.map(file => ({
    ...file,
    category: categorizeFile(file),
  }));

  // Determine the primary category by weight
  const weights = {};
  for (const f of categorized) {
    const w = f.additions + f.deletions || 1;
    weights[f.category] = (weights[f.category] || 0) + w;
  }

  const sorted = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  const primaryCategory = sorted.length > 0 ? sorted[0][0] : 'chore';

  const scope = detectScope(parsedDiff.files);

  return {
    files: categorized,
    stats: parsedDiff.stats,
    primaryCategory,
    categories: Object.fromEntries(sorted),
    scope,
  };
}

// ─── Breaking change detection ────────────────────────────────────────
function detectBreakingChanges(parsedDiff) {
  const breaking = [];

  for (const file of parsedDiff.files) {
    // Deleted files that are likely public API
    if (file.status === 'deleted') {
      if (isPublicFile(file.path)) {
        breaking.push({
          type: 'file_deleted',
          file: file.path,
          severity: 'high',
          description: `Public file deleted: ${file.path}`,
        });
      }
      continue;
    }

    const removedText = file.removedLines.join('\n');
    const addedText = file.addedLines.join('\n');

    // Removed exports
    const removedExports = extractExports(removedText);
    const addedExports = extractExports(addedText);
    for (const exp of removedExports) {
      if (!addedExports.includes(exp)) {
        breaking.push({
          type: 'export_removed',
          file: file.path,
          name: exp,
          severity: 'high',
          description: `Exported "${exp}" was removed from ${file.path}`,
        });
      }
    }

    // Function signature changes
    const removedFns = extractFunctionSignatures(removedText);
    const addedFns = extractFunctionSignatures(addedText);
    for (const [name, oldSig] of Object.entries(removedFns)) {
      if (addedFns[name] && addedFns[name] !== oldSig) {
        breaking.push({
          type: 'signature_changed',
          file: file.path,
          name,
          oldSignature: oldSig,
          newSignature: addedFns[name],
          severity: 'medium',
          description: `Function "${name}" signature changed in ${file.path}`,
        });
      } else if (!addedFns[name]) {
        breaking.push({
          type: 'function_removed',
          file: file.path,
          name,
          severity: 'high',
          description: `Function "${name}" was removed from ${file.path}`,
        });
      }
    }

    // Renamed/removed class or type
    const removedClasses = extractClasses(removedText);
    const addedClasses = extractClasses(addedText);
    for (const cls of removedClasses) {
      if (!addedClasses.includes(cls)) {
        breaking.push({
          type: 'class_removed',
          file: file.path,
          name: cls,
          severity: 'high',
          description: `Class/type "${cls}" was removed from ${file.path}`,
        });
      }
    }

    // Major version bump in package.json
    if (file.path.endsWith('package.json')) {
      const oldVer = removedText.match(/"version"\s*:\s*"(\d+)\./);
      const newVer = addedText.match(/"version"\s*:\s*"(\d+)\./);
      if (oldVer && newVer && parseInt(newVer[1]) > parseInt(oldVer[1])) {
        breaking.push({
          type: 'major_version_bump',
          file: file.path,
          oldVersion: oldVer[0],
          newVersion: newVer[0],
          severity: 'info',
          description: 'Major version bump detected in package.json',
        });
      }
    }

    // Environment variable changes
    if (file.path.includes('.env') || file.path.endsWith('.yml') || file.path.endsWith('.yaml')) {
      const removedVars = extractEnvVars(removedText);
      const addedVars = extractEnvVars(addedText);
      for (const v of removedVars) {
        if (!addedVars.includes(v)) {
          breaking.push({
            type: 'env_var_removed',
            file: file.path,
            name: v,
            severity: 'medium',
            description: `Environment variable "${v}" was removed`,
          });
        }
      }
    }
  }

  return {
    hasBreakingChanges: breaking.length > 0,
    count: breaking.length,
    changes: breaking,
    summary: breaking.length > 0
      ? `${breaking.length} breaking change(s) detected: ${breaking.map(b => b.description).join('; ')}`
      : 'No breaking changes detected.',
  };
}

function isPublicFile(path) {
  const p = path.toLowerCase();
  return p.startsWith('src/') || p.startsWith('lib/') ||
    p.includes('/api/') || p.includes('index.') ||
    p.endsWith('.d.ts') || p.includes('/public/');
}

function extractExports(text) {
  const exports = [];
  // ES module exports
  const namedExports = text.matchAll(/export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g);
  for (const m of namedExports) exports.push(m[1]);
  // export default
  if (/export\s+default\s+/.test(text)) exports.push('default');
  // module.exports
  const cjsExports = text.matchAll(/(?:module\.)?exports\.(\w+)/g);
  for (const m of cjsExports) exports.push(m[1]);
  return [...new Set(exports)];
}

function extractFunctionSignatures(text) {
  const sigs = {};
  // function name(params)
  const fnDecls = text.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g);
  for (const m of fnDecls) sigs[m[1]] = m[2].trim();
  // const name = (params) =>
  const arrowFns = text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g);
  for (const m of arrowFns) sigs[m[1]] = m[2].trim();
  return sigs;
}

function extractClasses(text) {
  const classes = [];
  const matches = text.matchAll(/(?:class|interface|type|enum)\s+(\w+)/g);
  for (const m of matches) classes.push(m[1]);
  return [...new Set(classes)];
}

function extractEnvVars(text) {
  const vars = [];
  const matches = text.matchAll(/^([A-Z][A-Z0-9_]+)\s*=/gm);
  for (const m of matches) vars.push(m[1]);
  return [...new Set(vars)];
}

module.exports = {
  parseDiff,
  categorizeDiff,
  categorizeFile,
  detectScope,
  detectBreakingChanges,
};
