import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint } from '../src/linter.js';
import { run } from '../src/cli.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures');

/** Lint a fixture directory; returns the result plus a sorted list of rule ids. */
export function lintFixture(rel, opts = {}) {
  const dir = path.join(FIXTURES, rel);
  const result = lint({ cwd: dir, paths: ['.'], ...opts });
  return { ...result, ids: result.findings.map((f) => f.ruleId).sort() };
}

export function uniq(ids) {
  return [...new Set(ids)].sort();
}

/** Copy a fixture (or nothing) into a fresh temp directory. */
export function tempDir(fromFixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skilllint-'));
  if (fromFixture) fs.cpSync(path.join(FIXTURES, fromFixture), dir, { recursive: true });
  return dir;
}

export function write(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

export function cli(args, opts = {}) {
  let out = '';
  let err = '';
  const code = run(args, {
    cwd: opts.cwd || ROOT,
    env: opts.env || {},
    stdout: { write: (s) => (out += s), isTTY: false },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}

export const GOOD_DESC = 'Extracts text and tables from PDF files, fills PDF forms and merges documents. Use when working with PDF files or when the user mentions PDFs, forms or document extraction.';

export function skillMd({ name = 'my-skill', description = GOOD_DESC, extra = '', body = '# Title\n\nInstructions.\n' } = {}) {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}`;
}
