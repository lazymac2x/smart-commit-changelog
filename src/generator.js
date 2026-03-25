/**
 * generator.js — Commit message, changelog, and release notes generation.
 * Entirely local, zero external API calls.
 */

const { parseDiff, categorizeDiff, detectBreakingChanges } = require('./analyzer');

// ─── Commit message generation ────────────────────────────────────────

const TYPE_LABELS = {
  feat: 'feat',
  fix: 'fix',
  refactor: 'refactor',
  docs: 'docs',
  style: 'style',
  test: 'test',
  chore: 'chore',
};

/**
 * Generate a conventional commit message from a git diff string.
 */
function generateCommitMessage(diffText, options = {}) {
  const parsed = parseDiff(diffText);
  if (parsed.files.length === 0) {
    return { message: 'chore: empty commit', type: 'chore', scope: null, body: null, breaking: false };
  }

  const analysis = categorizeDiff(parsed);
  const breaking = detectBreakingChanges(parsed);

  const type = options.type || analysis.primaryCategory;
  const scope = options.scope || analysis.scope;
  const breakingFlag = breaking.hasBreakingChanges;

  // Build subject line
  const subject = buildSubject(analysis, type);
  const scopePart = scope ? `(${scope})` : '';
  const bangPart = breakingFlag ? '!' : '';
  const headline = `${TYPE_LABELS[type] || type}${scopePart}${bangPart}: ${subject}`;

  // Build body
  const body = buildBody(analysis, breaking);

  // Build footer
  const footer = breakingFlag
    ? `BREAKING CHANGE: ${breaking.changes.map(c => c.description).join('. ')}`
    : null;

  const parts = [headline];
  if (body) parts.push('', body);
  if (footer) parts.push('', footer);

  return {
    message: parts.join('\n'),
    headline,
    type: TYPE_LABELS[type] || type,
    scope,
    subject,
    body,
    footer,
    breaking: breakingFlag,
  };
}

function buildSubject(analysis, type) {
  const { files, stats } = analysis;

  // Single file — be specific
  if (files.length === 1) {
    const f = files[0];
    const fileName = f.path.split('/').pop();

    if (f.status === 'added') return `add ${fileName}`;
    if (f.status === 'deleted') return `remove ${fileName}`;
    if (f.status === 'renamed') return `rename ${f.oldPath?.split('/').pop() || 'file'} to ${fileName}`;

    // Try to extract meaningful description from changes
    const desc = extractChangeDescription(f);
    if (desc) return desc;

    return `update ${fileName}`;
  }

  // Multiple files in same category
  const categories = [...new Set(files.map(f => f.category))];
  if (categories.length === 1) {
    const cat = categories[0];
    if (cat === 'test') return `update tests (${files.length} files)`;
    if (cat === 'docs') return `update documentation`;
    if (cat === 'style') return `update styles`;
    if (cat === 'chore') return `update project configuration`;
  }

  // Multiple files — summarize
  const newFiles = files.filter(f => f.status === 'added');
  const deletedFiles = files.filter(f => f.status === 'deleted');
  const modifiedFiles = files.filter(f => f.status === 'modified');

  const parts = [];
  if (newFiles.length > 0) parts.push(`add ${newFiles.length} file(s)`);
  if (modifiedFiles.length > 0) parts.push(`update ${modifiedFiles.length} file(s)`);
  if (deletedFiles.length > 0) parts.push(`remove ${deletedFiles.length} file(s)`);

  if (parts.length > 0) return parts.join(', ');

  return `update ${stats.filesChanged} files (+${stats.additions}/-${stats.deletions})`;
}

function extractChangeDescription(file) {
  const added = file.addedLines || [];
  const removed = file.removedLines || [];

  // Look for added function/class definitions
  for (const line of added) {
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (fnMatch) return `add ${fnMatch[1]} function`;

    const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
    if (classMatch) return `add ${classMatch[1]} class`;

    const constFnMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (constFnMatch) return `add ${constFnMatch[1]}`;
  }

  // Look for error handling additions
  if (added.some(l => /try\s*\{|catch\s*\(|\.catch\(/.test(l))) {
    return `add error handling`;
  }

  // Look for validation
  if (added.some(l => /valid|check|assert|verify/i.test(l))) {
    return `add validation`;
  }

  return null;
}

function buildBody(analysis, breaking) {
  const lines = [];

  // Group files by category
  const groups = {};
  for (const f of analysis.files) {
    if (!groups[f.category]) groups[f.category] = [];
    groups[f.category].push(f);
  }

  // Only show body if there's enough to say
  if (analysis.files.length <= 1 && !breaking.hasBreakingChanges) return null;

  for (const [cat, files] of Object.entries(groups)) {
    if (files.length === 1) {
      lines.push(`- ${files[0].path} (${files[0].status}, +${files[0].additions}/-${files[0].deletions})`);
    } else {
      lines.push(`- ${cat}: ${files.length} files (+${files.reduce((s, f) => s + f.additions, 0)}/-${files.reduce((s, f) => s + f.deletions, 0)})`);
    }
  }

  return lines.join('\n');
}


// ─── Changelog generation ─────────────────────────────────────────────

/**
 * Generate a CHANGELOG.md from a git log string.
 * Expects `git log --format="%H|%s|%an|%ai|%D" --no-merges` output.
 */
function generateChangelog(gitLog, options = {}) {
  const { repoName, repoUrl } = options;
  const commits = parseGitLog(gitLog);
  if (commits.length === 0) {
    return '# Changelog\n\nNo commits found.\n';
  }

  // Group by version (tag) or "Unreleased"
  const versions = groupByVersion(commits);
  const lines = ['# Changelog', ''];

  if (repoName) {
    lines.push(`All notable changes to **${repoName}** will be documented in this file.`);
    lines.push('');
    lines.push('The format is based on [Keep a Changelog](https://keepachangelog.com/).', '');
  }

  for (const version of versions) {
    const heading = version.tag || 'Unreleased';
    const date = version.date ? ` — ${version.date}` : '';
    lines.push(`## [${heading}]${date}`, '');

    // Group commits by type
    const byType = {};
    for (const c of version.commits) {
      const type = c.type || 'other';
      if (!byType[type]) byType[type] = [];
      byType[type].push(c);
    }

    const typeOrder = ['feat', 'fix', 'refactor', 'docs', 'style', 'test', 'chore', 'other'];
    const typeHeadings = {
      feat: 'Features',
      fix: 'Bug Fixes',
      refactor: 'Refactoring',
      docs: 'Documentation',
      style: 'Styles',
      test: 'Tests',
      chore: 'Chores',
      other: 'Other',
    };

    for (const type of typeOrder) {
      const group = byType[type];
      if (!group || group.length === 0) continue;

      lines.push(`### ${typeHeadings[type] || type}`, '');
      for (const c of group) {
        const scope = c.scope ? `**${c.scope}:** ` : '';
        const hash = repoUrl ? `([${c.hash.slice(0, 7)}](${repoUrl}/commit/${c.hash}))` : `(${c.hash.slice(0, 7)})`;
        lines.push(`- ${scope}${c.subject} ${hash}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function parseGitLog(logText) {
  if (!logText || typeof logText !== 'string') return [];

  return logText.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    if (parts.length < 3) return null;

    const hash = parts[0].trim();
    const fullMessage = parts[1].trim();
    const author = parts[2].trim();
    const date = parts[3] ? parts[3].trim().split(' ')[0] : null;
    const refs = parts[4] ? parts[4].trim() : '';

    // Parse conventional commit
    const parsed = parseConventionalCommit(fullMessage);

    // Extract tag from refs
    const tagMatch = refs.match(/tag:\s*v?([^\s,)]+)/);
    const tag = tagMatch ? tagMatch[1] : null;

    return {
      hash,
      message: fullMessage,
      author,
      date,
      refs,
      tag,
      ...parsed,
    };
  }).filter(Boolean);
}

function parseConventionalCommit(message) {
  // Match: type(scope)!: subject
  const match = message.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (match) {
    return {
      type: match[1],
      scope: match[2] || null,
      breaking: !!match[3],
      subject: match[4],
    };
  }

  // Heuristic fallback for non-conventional commits
  const lower = message.toLowerCase();
  let type = 'other';
  if (/^fix|^bug|^patch|^hotfix/i.test(lower)) type = 'fix';
  else if (/^feat|^add|^new|^implement/i.test(lower)) type = 'feat';
  else if (/^refactor|^clean|^restructur/i.test(lower)) type = 'refactor';
  else if (/^doc|^readme|^changelog/i.test(lower)) type = 'docs';
  else if (/^test/i.test(lower)) type = 'test';
  else if (/^style|^css|^format/i.test(lower)) type = 'style';
  else if (/^chore|^build|^ci|^deps|^bump/i.test(lower)) type = 'chore';

  return {
    type,
    scope: null,
    breaking: /\bBREAKING\b/.test(message),
    subject: message,
  };
}

function groupByVersion(commits) {
  const versions = [];
  let current = { tag: null, date: null, commits: [] };

  for (const commit of commits) {
    if (commit.tag) {
      // Start a new version group
      if (current.commits.length > 0) {
        versions.push(current);
      }
      current = { tag: commit.tag, date: commit.date, commits: [commit] };
    } else {
      current.commits.push(commit);
    }
  }

  if (current.commits.length > 0) {
    versions.push(current);
  }

  return versions;
}


// ─── Release notes generation ─────────────────────────────────────────

/**
 * Generate human-readable release notes from git log between two refs.
 */
function generateReleaseNotes(gitLog, options = {}) {
  const { version, date, repoName, repoUrl } = options;
  const commits = parseGitLog(gitLog);

  if (commits.length === 0) {
    return `# Release Notes\n\nNo changes in this release.\n`;
  }

  const lines = [];

  // Header
  const versionStr = version ? `v${version.replace(/^v/, '')}` : 'Release';
  const dateStr = date || commits[0]?.date || new Date().toISOString().split('T')[0];
  lines.push(`# ${repoName ? repoName + ' ' : ''}${versionStr}`, '');
  lines.push(`**Release Date:** ${dateStr}`, '');

  // Summary stats
  const breaking = commits.filter(c => c.breaking);
  const features = commits.filter(c => c.type === 'feat');
  const fixes = commits.filter(c => c.type === 'fix');
  const others = commits.filter(c => !['feat', 'fix'].includes(c.type) && !c.breaking);

  if (breaking.length > 0 || features.length > 0 || fixes.length > 0) {
    lines.push('## Highlights', '');
    if (breaking.length > 0) {
      lines.push(`> **${breaking.length} breaking change(s)** in this release. Please review carefully before upgrading.`, '');
    }
    if (features.length > 0) {
      lines.push(`This release includes **${features.length} new feature(s)** and **${fixes.length} bug fix(es)**.`, '');
    }
  }

  // Breaking changes first
  if (breaking.length > 0) {
    lines.push('## Breaking Changes', '');
    for (const c of breaking) {
      const scope = c.scope ? `**${c.scope}:** ` : '';
      lines.push(`- ${scope}${c.subject}`);
    }
    lines.push('');
  }

  // New Features
  if (features.length > 0) {
    lines.push('## New Features', '');
    for (const c of features) {
      const scope = c.scope ? `**${c.scope}:** ` : '';
      lines.push(`- ${scope}${c.subject}`);
    }
    lines.push('');
  }

  // Bug Fixes
  if (fixes.length > 0) {
    lines.push('## Bug Fixes', '');
    for (const c of fixes) {
      const scope = c.scope ? `**${c.scope}:** ` : '';
      lines.push(`- ${scope}${c.subject}`);
    }
    lines.push('');
  }

  // Other changes (grouped)
  if (others.length > 0) {
    const grouped = {};
    for (const c of others) {
      const t = c.type || 'other';
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(c);
    }

    const typeNames = {
      refactor: 'Refactoring', docs: 'Documentation', style: 'Styles',
      test: 'Tests', chore: 'Maintenance', other: 'Other Changes',
    };

    for (const [type, items] of Object.entries(grouped)) {
      lines.push(`## ${typeNames[type] || type}`, '');
      for (const c of items) {
        const scope = c.scope ? `**${c.scope}:** ` : '';
        lines.push(`- ${scope}${c.subject}`);
      }
      lines.push('');
    }
  }

  // Contributors
  const authors = [...new Set(commits.map(c => c.author).filter(Boolean))];
  if (authors.length > 0) {
    lines.push('## Contributors', '');
    for (const a of authors) {
      lines.push(`- ${a}`);
    }
    lines.push('');
  }

  // Commit count
  lines.push('---', '');
  lines.push(`*${commits.length} commit(s) in this release.*`);

  return lines.join('\n');
}


// ─── Diff summary ─────────────────────────────────────────────────────

function diffSummary(diffText) {
  const parsed = parseDiff(diffText);
  const analysis = categorizeDiff(parsed);
  const breaking = detectBreakingChanges(parsed);

  return {
    stats: analysis.stats,
    primaryCategory: analysis.primaryCategory,
    categories: analysis.categories,
    scope: analysis.scope,
    files: analysis.files.map(f => ({
      path: f.path,
      status: f.status,
      category: f.category,
      additions: f.additions,
      deletions: f.deletions,
    })),
    breakingChanges: breaking.hasBreakingChanges ? breaking.summary : null,
  };
}

module.exports = {
  generateCommitMessage,
  generateChangelog,
  generateReleaseNotes,
  diffSummary,
  parseConventionalCommit,
};
