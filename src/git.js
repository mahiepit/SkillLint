// Read file modes and line endings from the git index, when available.
// The index is what gets published, so it is a better source of truth than
// the working tree on Windows (where checkouts convert LF to CRLF and the
// executable bit does not exist).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootCache = new Map();
const indexCache = new Map();

// Canonical path for map keys. realpath expands Windows 8.3 short names
// (C:\Users\RUNNER~1\...) and symlinks, which `git rev-parse` always returns expanded.
function norm(p) {
  let r = path.resolve(p);
  try {
    r = fs.realpathSync.native(r);
  } catch {
    // Not on disk: keep the resolved path.
  }
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function git(args, cwd) {
  try {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0 || res.error) return null;
    return res.stdout;
  } catch {
    return null;
  }
}

export function repoRoot(dir) {
  const key = norm(dir);
  if (rootCache.has(key)) return rootCache.get(key);
  if (process.env.SKILLLINT_NO_GIT === '1') {
    rootCache.set(key, null);
    return null;
  }
  const out = git(['rev-parse', '--show-toplevel'], dir);
  const root = out ? path.resolve(out.trim()) : null;
  rootCache.set(key, root);
  return root;
}

function loadIndex(root) {
  const key = norm(root);
  if (indexCache.has(key)) return indexCache.get(key);
  const map = new Map();
  const out = git(['ls-files', '-s', '--eol', '-z'], root);
  if (out) {
    for (const rec of out.split('\0')) {
      if (!rec) continue;
      const parts = rec.split('\t');
      if (parts.length < 3) continue;
      const mode = parts[0].split(' ')[0];
      const eol = parts[1].trim().split(/\s+/);
      const rel = parts.slice(2).join('\t');
      const index = (eol.find((e) => e.startsWith('i/')) || '').slice(2);
      map.set(norm(path.join(root, rel)), { mode, eol: index });
    }
  }
  indexCache.set(key, map);
  return map;
}

/**
 * @returns {{mode: string, eol: string} | null} null when the file is not tracked by git
 */
export function gitFileInfo(absFile) {
  const root = repoRoot(path.dirname(absFile));
  if (!root) return null;
  return loadIndex(root).get(norm(absFile)) || null;
}

export function clearGitCache() {
  rootCache.clear();
  indexCache.clear();
}
