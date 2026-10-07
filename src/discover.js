// Find SKILL.md files and Claude Code plugin manifests under the given paths.
import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './fsutil.js';

const SKIP = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', '.tox', '.next', '.nuxt', '.cache', '.idea', '.vscode', '.pytest_cache', '.mypy_cache', 'coverage']);
const MAX_DEPTH = 12;
const SKILL_FILE_RE = /^skill\.md$/i;

/**
 * @param {string[]} inputs files or directories
 * @param {{cwd: string, isIgnored: (abs: string) => boolean}} opts
 */
export function discover(inputs, opts) {
  const skills = new Map();
  const plugins = new Set();
  const marketplaces = new Set();
  const problems = [];
  const rel = (p) => toPosix(path.relative(opts.cwd, p)) || '.';

  const addFile = (abs, explicit) => {
    const base = path.basename(abs);
    const parent = path.basename(path.dirname(abs));
    if (SKILL_FILE_RE.test(base)) {
      skills.set(abs, { file: abs, dir: path.dirname(abs) });
      return true;
    }
    if (parent === '.claude-plugin' && base === 'plugin.json') {
      plugins.add(abs);
      return true;
    }
    if (parent === '.claude-plugin' && base === 'marketplace.json') {
      marketplaces.add(abs);
      return true;
    }
    if (explicit) problems.push(`${rel(abs)} is not a SKILL.md, .claude-plugin/plugin.json or .claude-plugin/marketplace.json file`);
    return false;
  };

  const walk = (dir, depth, honorIgnore) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Prefer the exactly named SKILL.md when a directory has several spellings.
    const hasExact = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (honorIgnore && opts.isIgnored(abs)) continue;
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        walk(abs, depth + 1, honorIgnore);
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (SKILL_FILE_RE.test(e.name) && e.name !== 'SKILL.md' && hasExact) continue;
        addFile(abs, false);
      }
    }
  };

  for (const input of inputs) {
    const abs = path.resolve(opts.cwd, input);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      problems.push(`${input}: no such file or directory`);
      continue;
    }
    if (st.isFile()) addFile(abs, true);
    // A path given explicitly is linted even if an ignore pattern covers it.
    else walk(abs, 0, !opts.isIgnored(abs));
  }

  const sorted = (it) => [...it].sort((a, b) => a.localeCompare(b));
  return {
    skills: sorted(skills.keys()).map((k) => skills.get(k)),
    plugins: sorted(plugins),
    marketplaces: sorted(marketplaces),
    problems,
  };
}
