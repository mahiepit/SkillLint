// Extract file references from Markdown: links, images, and bare paths
// such as `scripts/extract.py` (the style the Agent Skills spec uses).

const SKILL_DIR_VARS = /\$\{CLAUDE_SKILL_DIR\}\/|\$CLAUDE_SKILL_DIR\/|\{baseDir\}\//g;
// Only the directory names the Agent Skills spec and the Claude docs use for
// bundled files; other prefixes (src/, docs/, ...) usually mean the user's project.
const KNOWN_DIRS = '(?:scripts|references|reference|assets)';
const PATH_RE = new RegExp(`(?<![\\w./\\\\$@-])(?:\\./)?(${KNOWN_DIRS}/[A-Za-z0-9_./-]*)`, 'g');
const WIN_PATH_RE = new RegExp(`(?<![\\w./\\\\])(${KNOWN_DIRS}\\\\[A-Za-z0-9_.\\\\-]+)`, 'g');
const PRIVATE_PATH_RE = /(?:\/Users\/[^/\s`'")]+\/|\/home\/[^/\s`'")]+\/|[A-Za-z]:\\Users\\[^\\\s`'")]+\\)/g;
// Lines that talk about hypothetical files ("e.g. `references/finance.md`").
const EXAMPLE_RE = /\b(e\.g\.|i\.e\.|for example|for instance|examples?|such as|would|could|might|hypothetical|placeholder|imagine|suppose)\b/i;
const LINK_RE =/(!?)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REF_DEF_RE = /^\s{0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+)/;

function blankOut(s) {
  return s.replace(/[^\n]/g, ' ');
}

/**
 * @param {string} text Markdown text
 * @param {number} startLine line number (1-based) of the first line of `text`
 */
export function extractReferences(text, startLine = 1) {
  const links = [];
  const paths = [];
  const windowsPaths = [];
  const privatePaths = [];
  const lines = text.split('\n');
  let fence = null;
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = startLine + idx;
    const raw = lines[idx];
    const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    let inCode = fence !== null;
    if (fm) {
      if (fence === null) {
        fence = fm[1];
        inCode = true;
      } else if (fm[1][0] === fence[0] && fm[1].length >= fence.length && raw.trim() === fm[1]) {
        fence = null;
        inCode = true;
      }
    }
    const scan = raw.replace(SKILL_DIR_VARS, (m) => ' '.repeat(m.length));

    // Bare paths, Windows-style paths and private absolute paths are checked
    // everywhere, including code, because agents copy commands verbatim.
    // Indented continuation lines belong to the list item or paragraph above.
    let example = EXAMPLE_RE.test(raw);
    for (let back = idx - 1, cont = /^\s+\S/.test(raw); !example && cont && back >= 0 && idx - back <= 4; back--) {
      if (lines[back].trim() === '') break;
      example = EXAMPLE_RE.test(lines[back]);
      cont = /^\s+\S/.test(lines[back]);
    }
    for (const m of scan.matchAll(PATH_RE)) {
      // Globs and placeholders such as references/layouts*.md or scripts/<name>.py are not paths.
      if (/[*<{[$]/.test(scan[m.index + m[0].length] || '')) continue;
      let p = m[1].replace(/[.,;:]+$/, '');
      const isDirRef = p.endsWith('/');
      if (isDirRef) p = p.slice(0, -1);
      if (!p.includes('/')) continue;
      paths.push({ target: p, line: lineNo, column: m.index + 1 + (m[0].length - m[1].length), isDir: isDirRef, example });
    }
    for (const m of scan.matchAll(WIN_PATH_RE)) {
      windowsPaths.push({ target: m[1], line: lineNo, column: m.index + 1 });
    }
    for (const m of scan.matchAll(PRIVATE_PATH_RE)) {
      privatePaths.push({ target: m[0], line: lineNo, column: m.index + 1 });
    }
    if (inCode) continue;

    // Links are only links outside code.
    const noCode = scan.replace(/(`+)([\s\S]*?)\1/g, (m) => blankOut(m));
    for (const m of noCode.matchAll(LINK_RE)) {
      let target = m[3];
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      links.push({ target, line: lineNo, column: m.index + 1, image: m[1] === '!' });
    }
    const def = REF_DEF_RE.exec(noCode);
    if (def) {
      let target = def[2];
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      links.push({ target, line: lineNo, column: 1, image: false });
    }
  }
  // A link target is also matched as a bare path; keep only the link.
  const linkKeys = new Set(links.map((l) => `${l.line}:${normalizeTarget(l.target)}`));
  const dedupedPaths = paths.filter((p) => !linkKeys.has(`${p.line}:${p.target}`));
  return { links, paths: dedupedPaths, windowsPaths, privatePaths };
}

function normalizeTarget(t) {
  return t.replace(/^\.\//, '').replace(/[#?].*$/, '').replace(/\/$/, '');
}

/** Classify a link target. */
export function classifyTarget(target) {
  const t = target.trim();
  if (!t) return { kind: 'empty' };
  if (t.startsWith('#')) return { kind: 'anchor' };
  if (/^file:/i.test(t)) return { kind: 'absolute', path: t };
  if (/^[A-Za-z]:[\\/]/.test(t) || t.startsWith('/') || t.startsWith('\\\\') || t.startsWith('~')) return { kind: 'absolute', path: t };
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return { kind: 'url' };
  if (/[{}$<>*]/.test(t)) return { kind: 'template' };
  // Placeholders: [title](URL), [x](link), [file](path/to/file.md)
  if (/^[A-Z][A-Z0-9_]*$/.test(t) || /^(url|link|href|path|file)$/i.test(t) || /(^|\/)path\/to\//i.test(t) || t.includes('...')) return { kind: 'template' };
  let p = t.replace(/[#?].*$/, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  return { kind: 'relative', path: p, backslash: p.includes('\\') };
}

/** Count Markdown lines that are not blank. */
export function estimateTokens(text) {
  // ~4 characters per token is the usual rule of thumb for English prose.
  return Math.ceil(text.length / 4);
}
