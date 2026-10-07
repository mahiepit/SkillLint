import fs from 'node:fs';
import path from 'node:path';

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Like exists(), but also requires every path segment below `root` to match
 * the case on disk. Windows and macOS file systems are case-insensitive, Linux
 * is not, so `References/Guide.md` works locally and breaks in CI or for users.
 * @returns {{exists: boolean, actual?: string}}
 */
export function existsExactCase(abs, root) {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { exists: exists(abs) };
  const parts = rel.split(/[\\/]/).filter(Boolean);
  let cur = root;
  const actual = [];
  let caseMismatch = false;
  for (const part of parts) {
    let entries;
    try {
      entries = fs.readdirSync(cur);
    } catch {
      return { exists: false };
    }
    let next = entries.includes(part) ? part : null;
    if (!next) {
      next = entries.find((e) => e.toLowerCase() === part.toLowerCase()) || null;
      if (!next) return { exists: false };
      caseMismatch = true;
    }
    actual.push(next);
    cur = path.join(cur, next);
  }
  return caseMismatch ? { exists: false, actual: actual.join('/') } : { exists: true };
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Edit a text file line by line, preserving a BOM and CRLF endings. */
export function editLines(text, fn) {
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  const lines = body.split('\n');
  fn(lines);
  return (bom ? '﻿' : '') + lines.join('\n');
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}
