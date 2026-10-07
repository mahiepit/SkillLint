// Rules for a single skill directory (SKILL.md + bundled files).
import fs from 'node:fs';
import path from 'node:path';
import { splitFrontmatter } from '../frontmatter.js';
import { parseYaml } from '../yaml.js';
import { extractReferences, classifyTarget, estimateTokens } from '../markdown.js';
import { gitFileInfo } from '../git.js';
import { AGENTS, EXTRA_FIELDS, KNOWN_FIELDS, SPEC_FIELDS, labelList } from '../targets.js';
import { editLines, exists, existsExactCase, isBinary, isDir, isInside, levenshtein, toPosix } from '../fsutil.js';

const NAME_MAX = 64;
const CODEX_NAME_MAX = 100;
const DESCRIPTION_MAX = 1024;
const CODEX_DESCRIPTION_MAX = 500;
const CLAUDE_LISTING_MAX = 1536;
const COMPATIBILITY_MAX = 500;
const BODY_LINES_MAX = 500;
const BODY_TOKENS_MAX = 5000;
const DESCRIPTION_MIN_CHARS = 40;
const REFERENCE_TOC_LINES = 100;
const MAX_FILES_SCANNED = 2000;

const VAGUE_NAMES = new Set(['helper', 'helpers', 'utils', 'util', 'utility', 'utilities', 'tool', 'tools', 'misc', 'stuff', 'documents', 'docs', 'data', 'files', 'skill', 'skills', 'my-skill', 'new-skill', 'example', 'test', 'temp', 'general', 'common']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv']);
const IGNORED_FILES = /^(__init__\.py|__main__\.py|conftest\.py|requirements(-\w+)?\.txt|pyproject\.toml|package(-lock)?\.json|tsconfig\.json|\.gitignore|SKILL\.md|LICEN[CS]E(\.\w+)?|COPYING(\.\w+)?|README(\.\w+)?|CHANGELOG(\.\w+)?|NOTICE(\.\w+)?|\.gitkeep|\.DS_Store|Thumbs\.db)$/i;
const TEXT_EXT = /\.(md|markdown|txt|py|js|mjs|cjs|ts|sh|bash|zsh|ps1|rb|pl|json|ya?ml|toml|html?|css|xml|csv|sql|ini|cfg)$/i;
const CODE_EXT = /\.(py|js|mjs|cjs|ts|rb|pl|sh|bash)$/i;
const SHELL_EXT = new Set(['.sh', '.bash', '.zsh', '.ksh', '.fish']);
const WINDOWS_SCRIPT_EXT = new Set(['.ps1', '.bat', '.cmd']);
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const TIME_SENSITIVE_RE = new RegExp(`\\b(?:before|after|until|since|as of|starting|from)\\s+(?:(?:${MONTHS})\\s+(?:\\d{1,2},?\\s+)?\\d{4}|Q[1-4]\\s+\\d{4}|\\d{4}\\b)`, 'i');
const TRIGGER_RE = /\b(use (it |this( skill)? )?(when|for|if|whenever|to|on|with|during|after|before)|when(ever)? (the )?(user|you|asked|working|handling|dealing|editing|creating|writing|reviewing|debugging|building|running|someone|a user|an? )|when\b.*\b(asks?|needs?|wants?|mentions?|requests?)|trigger(s|ed)?\b|invoke(d)? (when|for|if)|if the user|for (tasks|requests|questions|work) |applies (when|to))/i;
const PERSON_RE = /^\s*(I|I'm|I'll|I've|I can|We|We'll|We can|You|You can|You'll|Your|Let me|My|This skill (helps|lets) you)\b|\b(I can help|I will|I'll help|I am able|you can use this|let me help|helps you)\b/i;
const XML_TAG_RE = /<\/?[A-Za-z][\w:.-]*(\s[^<>]*)?\/?>/;
const DISABLE_RE = /<!--\s*skilllint-disable(?:\s+([\w\s,-]*?))?\s*-->/g;

/** Parse `<!-- skilllint-disable rule-a, rule-b -->` comments. Returns 'all', a Set, or null. */
export function inlineDisables(text) {
  let all = false;
  const ids = new Set();
  for (const m of text.matchAll(DISABLE_RE)) {
    const list = (m[1] || '').split(/[\s,]+/).filter(Boolean);
    if (!list.length) all = true;
    for (const id of list) ids.add(id);
  }
  if (all) return 'all';
  return ids.size ? ids : null;
}

function nameProblems(name) {
  const problems = [];
  if (/[A-Z]/.test(name)) problems.push('uppercase letters');
  if (/<\/?[A-Za-z]/.test(name)) problems.push('XML tags');
  const bad = [...new Set(name.replace(/[a-z0-9-]/g, '').replace(/[A-Z]/g, ''))];
  if (bad.length) problems.push(`invalid characters ${bad.map((c) => JSON.stringify(c)).join(' ')}`);
  if (name.startsWith('-') || name.endsWith('-')) problems.push('a leading or trailing hyphen');
  if (name.includes('--')) problems.push('consecutive hyphens');
  return problems;
}

export function toKebab(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'object') return 'mapping';
  return typeof v;
}

/** List files of a skill, skipping hidden entries and nested skills. */
function listSkillFiles(dir) {
  const out = [];
  const nestedSkills = [];
  const walk = (d, depth) => {
    if (out.length > MAX_FILES_SCANNED || depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (exists(path.join(abs, 'SKILL.md'))) {
          nestedSkills.push(abs);
          continue;
        }
        walk(abs, depth + 1);
      } else if (e.isFile()) {
        out.push(abs);
      }
    }
  };
  walk(dir, 0);
  return { files: out, nestedSkills };
}

/**
 * Lint one skill.
 * @param {{file: string, dir: string, text: string}} skill
 * @param {object} ctx  { report(id, finding), has(target), targets }
 * @returns {{name: string|null}} facts used by cross-skill checks
 */
export function lintSkill(skill, ctx) {
  const { file, dir } = skill;
  const text = skill.text;
  const dirName = path.basename(dir);
  const R = (id, f) => ctx.report(id, { file, ...f });

  // ---------------------------------------------------------------- file
  const base = path.basename(file);
  if (base !== 'SKILL.md') {
    R('skill-md-filename', {
      line: 1,
      message: `File is named "${base}"; agents look for exactly "SKILL.md" (case-sensitive on Linux and macOS).`,
      hint: 'Rename the file to SKILL.md (with git: git mv twice via a temporary name on case-insensitive systems).',
    });
  }

  const fm = splitFrontmatter(text);
  if (fm.bom) {
    R('file-bom', {
      line: 1,
      message: 'File starts with a UTF-8 byte order mark (BOM); loaders that check for a leading "---" (Gemini CLI, skills-ref) will not see the frontmatter.',
      hint: 'Save the file as "UTF-8" without BOM.',
      fix: { kind: 'text', apply: (t) => t.replace(/^﻿/, '') },
    });
  }

  const git = gitFileInfo(file);
  const crlf = git ? git.eol === 'crlf' || git.eol === 'mixed' : fm.crlf;
  if (crlf) {
    R('crlf-line-endings', {
      line: 1,
      message: 'SKILL.md uses CRLF (Windows) line endings.',
      hint: 'Convert to LF, and add "* text=auto eol=lf" to .gitattributes.',
      fix: { kind: 'text', apply: (t) => t.replace(/\r\n/g, '\n') },
    });
  }

  let data = null;
  let locations = new Map();
  const loc = (key) => locations.get(key) || { line: fm.startLine || 1, column: 1 };

  if (!fm.hasFrontmatter) {
    R('frontmatter-missing', {
      line: fm.lateDelimiterLine || 1,
      message: fm.lateDelimiterLine
        ? `Frontmatter must start on line 1, but the first "---" is on line ${fm.lateDelimiterLine}; agents will not read it.`
        : 'No YAML frontmatter: SKILL.md must start with "---", then name and description, then "---".',
      hint: fm.lateDelimiterLine
        ? 'Move the frontmatter block to the very top of the file (no blank lines or headings before it).'
        : `Add at the top:\n---\nname: ${toKebab(dirName) || 'my-skill'}\ndescription: <what it does>. Use when <trigger>.\n---`,
    });
  } else if (fm.unterminated) {
    R('frontmatter-unterminated', {
      line: 1,
      message: 'The frontmatter starts with "---" but has no closing "---" line.',
      hint: 'Add a line containing only "---" after the last frontmatter field.',
    });
  } else {
    // delimiters
    for (const [lineNo, value] of [
      [fm.startLine, fm.openDelimiter],
      [fm.endLine, fm.closeDelimiter],
    ]) {
      if (value !== '---' && value !== '...') {
        R('frontmatter-delimiter', {
          line: lineNo,
          message: `Delimiter line is "${value.replace(/\t/g, '\\t')}" instead of exactly "---"; Gemini CLI's loader requires a bare "---".`,
          hint: 'Remove the trailing whitespace from the delimiter line.',
          fix: {
            kind: 'text',
            apply: (t) =>
              editLines(t, (lines) => {
                const i = lineNo - 1;
                if (lines[i] !== undefined) lines[i] = lines[i].replace(/[ \t]+(\r?)$/, '$1');
              }),
          },
        });
      }
    }

    const y = parseYaml(fm.raw, { lineOffset: fm.startLine });
    locations = y.locations;
    for (const w of y.warnings) R('yaml-gotcha', { line: w.line, column: w.column, message: w.message, hint: 'Wrap the value in double quotes.' });
    if (y.error) {
      R('frontmatter-invalid-yaml', {
        line: y.error.line,
        column: y.error.column,
        message: `Invalid YAML: ${y.error.message}.`,
        hint: 'Agents skip skills whose frontmatter does not parse. Quoting the value usually fixes it: description: "..."',
      });
    } else if (!isPlainObject(y.value)) {
      R('frontmatter-invalid-yaml', {
        line: fm.startLine,
        message: `Frontmatter must be a mapping of "key: value" pairs, but it is ${y.value === null ? 'empty' : `a ${typeName(y.value)}`}.`,
        hint: 'Add at least:\nname: <dir-name>\ndescription: <what it does>. Use when <trigger>.',
      });
      data = y.value === null ? {} : null;
    } else {
      data = y.value;
    }

    // trailing whitespace inside the frontmatter
    const fmLines = fm.raw.split('\n');
    const twLines = [];
    fmLines.forEach((l, i) => {
      if (/[ \t]+$/.test(l)) twLines.push(fm.startLine + 1 + i);
    });
    if (twLines.length) {
      R('trailing-whitespace', {
        line: twLines[0],
        message: `Trailing whitespace on ${twLines.length} frontmatter line${twLines.length > 1 ? 's' : ''} (${twLines.slice(0, 5).join(', ')}${twLines.length > 5 ? ', ...' : ''}).`,
        hint: 'Remove it (skilllint --fix does this).',
        fix: {
          kind: 'text',
          apply: (t) =>
            editLines(t, (lines) => {
              for (const ln of twLines) {
                const i = ln - 1;
                if (lines[i] !== undefined) lines[i] = lines[i].replace(/[ \t]+(\r?)$/, '$1');
              }
            }),
        },
      });
    }
  }

  // ---------------------------------------------------------------- fields
  let skillName = null;
  if (data && fm.hasFrontmatter && !fm.unterminated) {
    skillName = checkName(data, ctx, R, loc, dirName, skill, fm);
    checkDescription(data, ctx, R, loc, fm);
    const fileLines = text.replace(/^\ufeff/, '').split('\n');
    const rawValue = (key) => {
      const l = fileLines[loc(key).line - 1] || '';
      const i = l.indexOf(':');
      return i === -1 ? '' : l.slice(i + 1).replace(/\s+#.*$/, '').trim();
    };
    checkOtherFields(data, ctx, R, loc, dir, rawValue);
  }

  // ---------------------------------------------------------------- body
  const body = fm.body;
  if (fm.hasFrontmatter && !fm.unterminated && body.trim() === '') {
    R('body-empty', {
      line: fm.endLine || 1,
      message: 'SKILL.md has no instructions after the frontmatter.',
      hint: 'Add step-by-step instructions, examples and edge cases below the frontmatter.',
    });
  }
  const totalLines = text.replace(/\n+$/, '').split('\n').length;
  if (totalLines > BODY_LINES_MAX) {
    R('body-too-long', {
      line: BODY_LINES_MAX + 1,
      message: `SKILL.md is ${totalLines} lines; keep it under ${BODY_LINES_MAX} and move details into referenced files.`,
      hint: 'Split reference material into references/*.md and link to it from SKILL.md.',
    });
  }
  const tokens = estimateTokens(body);
  if (tokens > BODY_TOKENS_MAX) {
    R('body-token-budget', {
      line: fm.bodyStartLine,
      message: `The SKILL.md body is about ${tokens} tokens (estimated at 4 characters per token); the spec recommends under ${BODY_TOKENS_MAX}.`,
      hint: 'The whole body is loaded when the skill activates. Move rarely needed details into reference files.',
    });
  }
  checkAgentSyntax(body, fm.bodyStartLine, R);
  checkTimeSensitive(body, fm.bodyStartLine, R);

  // ---------------------------------------------------------------- files
  checkReferencesAndFiles(skill, fm, ctx);

  // ---------------------------------------------------------------- layout
  checkLayout(skill, ctx, R);

  return { name: skillName };
}

function checkName(data, ctx, R, loc, dirName, skill, fm) {
  const raw = data.name;
  if (raw === undefined || raw === null || raw === '') {
    R('name-missing', {
      line: raw === undefined ? fm.startLine : loc('name').line,
      message: `Missing required field \`name\`. Claude Code falls back to the directory name, but Codex, Cursor, Gemini CLI and Copilot skip or misname the skill.`,
      hint: `Add: name: ${toKebab(dirName)}`,
    });
    return null;
  }
  if (typeof raw !== 'string') {
    R('field-type', {
      ...loc('name'),
      message: `\`name\` must be a string, but YAML parsed it as a ${typeName(raw)} (${JSON.stringify(raw)}).`,
      hint: `Quote it: name: "${raw}"`,
    });
    return String(raw);
  }
  const name = raw.normalize('NFKC');
  const problems = nameProblems(name);
  if (problems.length) {
    const candidate = toKebab(name);
    const safe = candidate && !nameProblems(candidate).length && candidate === dirName.normalize('NFKC');
    R('name-format', {
      ...loc('name'),
      message: `\`name\` "${name}" contains ${problems.join(', ')}; only lowercase a-z, 0-9 and single hyphens are allowed.`,
      hint: candidate && !nameProblems(candidate).length ? `Use: name: ${candidate}` : 'Use lowercase letters, digits and hyphens, e.g. pdf-processing.',
      fix: safe
        ? {
            kind: 'text',
            apply: (t) =>
              editLines(t, (lines) => {
                const i = loc('name').line - 1;
                if (lines[i] !== undefined) lines[i] = lines[i].replace(/^(\s*name\s*:\s*).*?(\r?)$/, `$1${candidate}$2`);
              }),
          }
        : undefined,
    });
  }
  if (name.length > NAME_MAX) {
    R('name-too-long', {
      ...loc('name'),
      message: `\`name\` is ${name.length} characters; the limit is ${NAME_MAX}${name.length > CODEX_NAME_MAX ? ` (Codex also rejects names over ${CODEX_NAME_MAX})` : ''}.`,
      hint: 'Shorten the name and rename the directory to match.',
      affects: name.length > CODEX_NAME_MAX ? ['spec', 'claude', 'cursor', 'copilot', 'codex'] : undefined,
    });
  }
  if (!skill.isPluginRoot && name !== dirName.normalize('NFKC') && !(problems.length && toKebab(name) === dirName)) {
    R('name-dir-mismatch', {
      ...loc('name'),
      message: `\`name\` "${name}" does not match the directory name "${dirName}".`,
      hint: `Rename the directory to "${name}" or set name: ${dirName}. Cursor uses the folder name as the skill's identity, and skills-ref rejects the mismatch.`,
    });
  }
  if (/anthropic|claude/i.test(name)) {
    R('name-reserved-word', {
      ...loc('name'),
      message: `\`name\` "${name}" contains a reserved word ("anthropic" or "claude"); Claude's skill upload rejects it.`,
      hint: 'Pick a name that describes what the skill does.',
    });
  }
  if (VAGUE_NAMES.has(name)) {
    R('name-vague', {
      ...loc('name'),
      message: `\`name\` "${name}" is too generic to tell skills apart.`,
      hint: 'Use a specific name, ideally a gerund or action phrase such as processing-pdfs or review-pull-requests.',
    });
  }
  return name;
}

function checkDescription(data, ctx, R, loc, fm) {
  const raw = data.description;
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    R('description-missing', {
      line: raw === undefined ? fm.startLine : loc('description').line,
      message: 'Missing required field `description`. It is the only thing agents read to decide when to use the skill.',
      hint: 'Add: description: <What it does>. Use when <the situations or keywords that should trigger it>.',
    });
    return;
  }
  if (typeof raw !== 'string') {
    R('field-type', {
      ...loc('description'),
      message: `\`description\` must be a string, but YAML parsed it as a ${typeName(raw)}.`,
      hint: 'Write the description as one quoted string.',
    });
    return;
  }
  const d = raw.trim();
  const at = loc('description');
  if (d.length > DESCRIPTION_MAX) {
    R('description-too-long', {
      ...at,
      message: `\`description\` is ${d.length} characters; the limit is ${DESCRIPTION_MAX}.`,
      hint: 'Keep the key use case first and trim the rest; details belong in the body.',
    });
  }
  if (d.length > CODEX_DESCRIPTION_MAX) {
    R('description-too-long-codex', {
      ...at,
      message: `\`description\` is ${d.length} characters; the Codex skill loader rejects descriptions over ${CODEX_DESCRIPTION_MAX}.`,
      hint: `Keep it under ${CODEX_DESCRIPTION_MAX} characters to load in Codex as well.`,
    });
  }
  const words = d.split(/\s+/).filter(Boolean).length;
  if (d.length < DESCRIPTION_MIN_CHARS || words < 6) {
    R('description-too-short', {
      ...at,
      message: `\`description\` "${d}" is too short (${d.length} characters) for an agent to know when to use the skill.`,
      hint: 'Say what it does and when to use it, with the keywords users would say, e.g. "Extracts text and tables from PDF files. Use when working with PDFs or forms."',
    });
  }
  if (!TRIGGER_RE.test(d)) {
    R('description-no-trigger', {
      ...at,
      message: '`description` says what the skill does but not when to use it.',
      hint: 'Add a trigger sentence such as "Use when the user asks to ..." or "Use when working with ...".',
    });
  }
  if (PERSON_RE.test(d)) {
    R('description-person', {
      ...at,
      message: '`description` is written in the first or second person; it is injected into the system prompt, so write it in the third person.',
      hint: 'Write "Processes Excel files ..." instead of "I can help you process Excel files ...".',
    });
  }
  if (XML_TAG_RE.test(d)) {
    R('description-xml-tags', {
      ...at,
      message: '`description` contains an XML/HTML tag, which Claude does not allow in skill metadata.',
      hint: 'Remove the angle-bracket tag or reword it (for example "the <file> argument" -> "the FILE argument").',
    });
  }
  const whenToUse = typeof data.when_to_use === 'string' ? data.when_to_use.trim() : '';
  if (d.length + whenToUse.length > CLAUDE_LISTING_MAX) {
    R('description-listing-budget', {
      ...at,
      message: `\`description\`${whenToUse ? ' + `when_to_use`' : ''} is ${d.length + whenToUse.length} characters; Claude Code truncates the skill listing at ${CLAUDE_LISTING_MAX}.`,
      hint: 'Put the most important trigger words first.',
    });
  }
}

function checkOtherFields(data, ctx, R, loc, dir, rawValue) {
  // license
  if (data.license !== undefined && data.license !== null) {
    if (typeof data.license !== 'string') {
      R('field-type', { ...loc('license'), message: `\`license\` must be a string, but it is a ${typeName(data.license)}.`, hint: 'Use an SPDX id such as MIT, or the name of a bundled license file.' });
    } else {
      const m = /(?:^|[\s(])((?:LICEN[CS]E|COPYING)(?:[-_.][\w.-]*)?)(?=$|[\s),.;])/i.exec(data.license);
      if (m) {
        const fileName = m[1].replace(/[.,;]+$/, '');
        const candidates = [fileName, `${fileName}.txt`, `${fileName}.md`];
        if (!candidates.some((c) => exists(path.join(dir, c)))) {
          R('license-file-missing', {
            ...loc('license'),
            message: `\`license\` mentions "${fileName}", but there is no such file in the skill directory.`,
            hint: `Add ${fileName} next to SKILL.md, or use an SPDX id such as MIT.`,
          });
        }
      }
    }
  }

  // compatibility
  if (data.compatibility !== undefined) {
    const c = data.compatibility;
    if (typeof c !== 'string' || c.trim() === '' || c.length > COMPATIBILITY_MAX) {
      R('compatibility-invalid', {
        ...loc('compatibility'),
        message:
          typeof c !== 'string'
            ? `\`compatibility\` must be a string, but it is a ${typeName(c)}.`
            : c.trim() === ''
              ? '`compatibility` is empty; omit it unless the skill has environment requirements.'
              : `\`compatibility\` is ${c.length} characters; the limit is ${COMPATIBILITY_MAX}.`,
        hint: 'Example: compatibility: Requires git, docker and network access',
      });
    }
  }

  // metadata
  if (data.metadata !== undefined && data.metadata !== null) {
    if (!isPlainObject(data.metadata)) {
      R('metadata-invalid', { ...loc('metadata'), message: `\`metadata\` must be a mapping of keys to string values, but it is a ${typeName(data.metadata)}.`, hint: 'metadata:\n  author: your-name\n  version: "1.0"' });
    } else {
      for (const [k, v] of Object.entries(data.metadata)) {
        if (typeof v !== 'string') {
          R('metadata-invalid', {
            ...loc(`metadata.${k}`),
            message: `\`metadata.${k}\` is a ${typeName(v)} (${JSON.stringify(v)}), but metadata values must be strings${typeof v === 'number' ? '; unquoted versions like 1.0 or 1.10 are silently turned into numbers' : ''}.`,
            hint: `Quote it: ${k}: "${typeof v === 'object' && v !== null ? '...' : rawValue(`metadata.${k}`) || v}"`,
          });
        }
      }
    }
  }

  // allowed-tools
  const at = data['allowed-tools'];
  if (at !== undefined && at !== null) {
    if (Array.isArray(at)) {
      R('allowed-tools-format', {
        ...loc('allowed-tools'),
        message: '`allowed-tools` is a YAML list; the Agent Skills spec defines it as a space-separated string (Claude Code accepts both).',
        hint: `Use: allowed-tools: ${at.join(' ')}`,
      });
    } else if (typeof at !== 'string') {
      R('field-type', { ...loc('allowed-tools'), message: `\`allowed-tools\` must be a space-separated string, but it is a ${typeName(at)}.`, hint: 'Example: allowed-tools: Bash(git:*) Read' });
    }
  }

  // unknown and agent-specific fields
  for (const key of Object.keys(data)) {
    if (SPEC_FIELDS.includes(key)) continue;
    if (EXTRA_FIELDS[key]) {
      const supporters = EXTRA_FIELDS[key];
      const affects = ctx.targets.filter((t) => !supporters.includes(t));
      if (affects.length) {
        const others = affects.filter((t) => t !== 'spec');
        R('non-portable-field', {
          ...loc(key),
          affects,
          message: `\`${key}\` is only understood by ${labelList(supporters)}${others.length ? `; ${labelList(others)} ignore${others.length === 1 ? 's' : ''} it` : ''}${affects.includes('spec') ? '; it is not in the Agent Skills spec, so `skills-ref validate` and Claude skill uploads reject it' : ''}.`,
          hint: `Keep it only if you target ${labelList(supporters)}, or limit checks with --target ${supporters.join(',')}.`,
        });
      }
      continue;
    }
    const suggestion = KNOWN_FIELDS.map((f) => [f, levenshtein(key.toLowerCase(), f)]).sort((a, b) => a[1] - b[1])[0];
    R('unknown-field', {
      ...loc(key),
      message: `Unknown frontmatter field \`${key}\`; no supported agent reads it${suggestion && suggestion[1] <= 3 ? ` (did you mean \`${suggestion[0]}\`?)` : ''}.`,
      hint: 'Put custom data under `metadata:` instead.',
    });
  }

  // Claude Code field values
  if (ctx.has('claude')) {
    const boolish = (v) => typeof v === 'boolean' || v === 0 || v === 1 || (typeof v === 'string' && /^(true|false|yes|no|on|off|1|0)$/i.test(v));
    for (const key of ['disable-model-invocation', 'user-invocable', 'background']) {
      if (data[key] !== undefined && !boolish(data[key])) {
        R('field-type', { ...loc(key), affects: ['claude'], message: `\`${key}\` must be true or false, but it is ${JSON.stringify(data[key])}.`, hint: `${key}: true` });
      }
    }
    const enums = { context: ['fork'], effort: ['low', 'medium', 'high', 'xhigh', 'max'], shell: ['bash', 'powershell'] };
    for (const [key, allowed] of Object.entries(enums)) {
      if (data[key] !== undefined && !allowed.includes(data[key])) {
        R('field-type', { ...loc(key), affects: ['claude'], message: `\`${key}\` must be one of ${allowed.join(', ')}, but it is ${JSON.stringify(data[key])}.`, hint: `${key}: ${allowed[0]}` });
      }
    }
    for (const key of ['model', 'agent', 'argument-hint', 'when_to_use']) {
      if (data[key] !== undefined && data[key] !== null && typeof data[key] !== 'string') {
        R('field-type', { ...loc(key), affects: ['claude'], message: `\`${key}\` must be a string, but it is a ${typeName(data[key])}.`, hint: `Quote the value of ${key}.` });
      }
    }
    for (const key of ['arguments', 'paths', 'disallowed-tools']) {
      const v = data[key];
      if (v !== undefined && v !== null && typeof v !== 'string' && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) {
        R('field-type', { ...loc(key), affects: ['claude', 'cursor'], message: `\`${key}\` must be a string or a list of strings.`, hint: `${key}: [a, b]` });
      }
    }
    if (data.hooks !== undefined && data.hooks !== null && !isPlainObject(data.hooks)) {
      R('field-type', { ...loc('hooks'), affects: ['claude'], message: '`hooks` must be a mapping of hook events.', hint: 'See https://code.claude.com/docs/en/hooks' });
    }
    if (data.context !== 'fork' && data.agent !== undefined) {
      R('field-type', { ...loc('agent'), affects: ['claude'], message: '`agent` only has an effect together with `context: fork`.', hint: 'Add context: fork, or remove agent.' });
    }
  }
  if (ctx.has('cursor') && data.color !== undefined) {
    const colors = ['default', 'green', 'cyan', 'blue', 'purple', 'magenta', 'orange', 'yellow', 'red', 'brand'];
    if (!colors.includes(data.color)) {
      R('field-type', { ...loc('color'), affects: ['cursor'], message: `\`color\` must be one of ${colors.join(', ')}.`, hint: 'color: blue' });
    }
  }
}

function checkAgentSyntax(body, startLine, R) {
  const patterns = [
    [/\$ARGUMENTS\b/, '$ARGUMENTS'],
    [/\$\{CLAUDE_(SKILL_DIR|SESSION_ID|PLUGIN_ROOT|PLUGIN_DATA|PROJECT_DIR|EFFORT)\}/, null],
    [/(^|\s)!`[^`\n]+`/, '!`command` (dynamic context injection)'],
    [/^\s*```!/, '```! block (dynamic context injection)'],
  ];
  const lines = body.split('\n');
  for (const [re, label] of patterns) {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]);
      if (m) {
        const what = label || m[0];
        R('agent-specific-syntax', {
          line: startLine + i,
          column: m.index + 1,
          message: `${what} is expanded only by Claude Code; other agents show it to the model literally.`,
          hint: what.startsWith('${CLAUDE_SKILL_DIR}') ? 'Use paths relative to the skill root (scripts/x.py); agents resolve them from the skill directory.' : 'Describe the input in words, or keep this skill Claude Code-only with --target claude.',
        });
        break;
      }
    }
  }
}

function checkTimeSensitive(body, startLine, R) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = TIME_SENSITIVE_RE.exec(lines[i]);
    if (m) {
      R('time-sensitive', {
        line: startLine + i,
        column: m.index + 1,
        message: `Time-sensitive wording "${m[0]}" will become wrong; skills are used long after they are written.`,
        hint: 'Describe the current way, and move the old way into an "Old patterns" section.',
      });
      return;
    }
  }
}

function checkReferencesAndFiles(skill, fm, ctx) {
  const { dir, file } = skill;
  const { files } = listSkillFiles(dir);
  const mdFiles = files.filter((f) => /\.(md|markdown)$/i.test(f) && path.resolve(f) !== path.resolve(file));
  const referenced = new Set();
  const referencedDirs = new Set();
  const direct = new Set();
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

  const texts = new Map();
  texts.set(file, fm.body);

  const scanMarkdown = (mdFile, text, startLine, isMain) => {
    const R = (id, f) => ctx.report(id, { file: mdFile, ...f });
    const refs = extractReferences(text, startLine);
    const out = [];
    const absoluteLinkLines = new Set();
    for (const l of refs.links) {
      const c = classifyTarget(l.target);
      if (c.kind === 'absolute') {
        absoluteLinkLines.add(l.line);
        R('absolute-path', { line: l.line, column: l.column, message: `Link "${l.target}" is an absolute path that will not exist on other machines.`, hint: 'Link to a file inside the skill with a relative path, e.g. references/guide.md.' });
        continue;
      }
      if (c.kind !== 'relative') continue;
      let rel = c.path;
      if (c.backslash) {
        R('windows-path', { line: l.line, column: l.column, message: `Link "${l.target}" uses backslashes, which do not work as path separators on macOS/Linux.`, hint: `Use forward slashes: ${rel.replace(/\\/g, '/')}` });
        rel = rel.replace(/\\/g, '/');
      }
      const abs = path.resolve(path.dirname(mdFile), rel);
      const inside = isInside(abs, dir);
      const ex = inside ? existsExactCase(abs, dir) : { exists: exists(abs) };
      if (!ex.exists) {
        R('link-broken', {
          line: l.line,
          column: l.column,
          message: ex.actual ? `Link "${l.target}" only matches "${ex.actual}" with different letter case; it breaks on case-sensitive file systems (Linux).` : `Link "${l.target}" points to a file that does not exist.`,
          hint: ex.actual ? `Change the link to ${ex.actual}.` : 'Fix the path (relative to this file) or add the missing file.',
        });
        continue;
      }
      if (!inside) {
        R('link-escapes-skill', { line: l.line, column: l.column, message: `Link "${l.target}" points outside the skill directory; it breaks when the skill is installed or copied on its own.`, hint: 'Copy the file into the skill (e.g. references/) and link to the copy.' });
        continue;
      }
      out.push(abs);
      referenced.add(norm(abs));
      if (isDir(abs)) referencedDirs.add(norm(abs));
    }
    for (const p of refs.paths) {
      let abs = path.resolve(dir, p.target);
      let ex = existsExactCase(abs, dir);
      if (!ex.exists && !ex.actual && path.dirname(mdFile) !== dir) {
        const alt = path.resolve(path.dirname(mdFile), p.target);
        const exAlt = isInside(alt, dir) ? existsExactCase(alt, dir) : { exists: false };
        if (exAlt.exists) {
          abs = alt;
          ex = exAlt;
        }
      }
      if (!ex.exists) {
        // "scripts/check_fields" when only "scripts/check_fields.py" exists is a real bug;
        // other extension-less paths ("better scripts/tools") are usually prose.
        let suggestion = null;
        const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(path.basename(p.target));
        if (!hasExt && !ex.actual) {
          try {
            const parent = path.dirname(abs);
            const hit = fs.readdirSync(parent).find((e) => e.startsWith(`${path.basename(abs)}.`));
            if (hit) {
              suggestion = toPosix(path.relative(dir, path.join(parent, hit)));
              referenced.add(norm(path.join(parent, hit)));
            }
          } catch {
            /* parent does not exist */
          }
          if (!suggestion && !p.isDir) continue;
        }
        if (p.example && !suggestion && !ex.actual) continue;
        R('path-reference-missing', {
          line: p.line,
          column: p.column,
          message: ex.actual
            ? `"${p.target}" only matches "${ex.actual}" with different letter case; it breaks on Linux.`
            : suggestion
              ? `"${p.target}" does not exist; did you mean "${suggestion}"?`
              : `"${p.target}" is referenced but does not exist in the skill.`,
          hint: ex.actual ? `Use ${ex.actual}.` : suggestion ? `Use ${suggestion}.` : 'Add the file, or fix the path (paths are relative to the skill root).',
        });
        continue;
      }
      out.push(abs);
      referenced.add(norm(abs));
      if (isDir(abs)) referencedDirs.add(norm(abs));
    }
    for (const w of refs.windowsPaths) {
      R('windows-path', { line: w.line, column: w.column, message: `"${w.target}" uses backslashes; agents on macOS/Linux cannot resolve it.`, hint: `Use forward slashes: ${w.target.replace(/\\/g, '/')}` });
    }
    for (const a of refs.privatePaths) {
      if (absoluteLinkLines.has(a.line)) continue;
      R('absolute-path', { line: a.line, column: a.column, message: `"${a.target}" is a user-specific absolute path that will not exist on other machines.`, hint: 'Use a path relative to the skill, or describe the location (e.g. "the project root").' });
    }
    return out;
  };

  const fromMain = scanMarkdown(file, fm.body, fm.bodyStartLine, true);
  for (const f of fromMain) if (/\.(md|markdown)$/i.test(f)) direct.add(norm(f));

  for (const md of mdFiles) {
    let text;
    try {
      text = fs.readFileSync(md, 'utf8');
    } catch {
      continue;
    }
    texts.set(md, text);
    const targets = scanMarkdown(md, text, 1, false);
    const isDirect = direct.has(norm(md));
    if (isDirect) {
      const seenNested = new Set();
      for (const t of targets) {
        if (/\.(md|markdown)$/i.test(t) && !direct.has(norm(t)) && norm(t) !== norm(file) && !seenNested.has(norm(t))) {
          seenNested.add(norm(t));
          const rel = toPosix(path.relative(dir, t));
          const line = findLine(text, path.basename(t));
          ctx.report('nested-reference', {
            file: md,
            line,
            message: `${rel} is only linked from ${toPosix(path.relative(dir, md))}, not from SKILL.md; agents may only preview nested references.`,
            hint: `Link ${rel} directly from SKILL.md (keep references one level deep).`,
          });
        }
      }
      const lineCount = text.split('\n').length;
      const head = text.split('\n').slice(0, 60).join('\n');
      if (lineCount > REFERENCE_TOC_LINES && !/^#{1,6}\s*(table of )?contents\b/im.test(head) && !/^\s*[-*+]\s*\[[^\]]+\]\(#/m.test(head)) {
        ctx.report('reference-no-toc', {
          file: md,
          line: 1,
          message: `${toPosix(path.relative(dir, md))} is ${lineCount} lines but has no table of contents near the top.`,
          hint: 'Add a "## Contents" list so an agent previewing the file sees its full scope.',
        });
      }
    }
  }

  checkScripts(skill, files, ctx);

  // Unreferenced files. A file counts as mentioned if its path or name appears
  // in any Markdown file or small text file of the skill (scripts load schemas,
  // templates and data by name).
  const corpus = [...texts.values()];
  const code = [];
  for (const f of files) {
    if (texts.has(f) || !TEXT_EXT.test(f)) continue;
    try {
      const st = fs.statSync(f);
      if (st.size > 256 * 1024) continue;
      const content = fs.readFileSync(f, 'utf8');
      corpus.push(content);
      if (CODE_EXT.test(f)) code.push([f, content]);
    } catch {
      /* ignore */
    }
  }
  const allText = corpus.join('\n');
  // Code modules are often only imported by other code ("from helpers import x").
  const importedByOtherCode = (f) => {
    if (!CODE_EXT.test(f)) return false;
    const stem = path.basename(f, path.extname(f));
    if (stem.length < 3) return false;
    const re = new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return code.some(([other, content]) => other !== f && re.test(content));
  };
  const sep = process.platform === 'win32' ? '\\' : '/';
  const unreferenced = [];
  for (const f of files) {
    const rel = toPosix(path.relative(dir, f));
    if (path.resolve(f) === path.resolve(file)) continue;
    if (IGNORED_FILES.test(path.basename(f))) continue;
    if (rel === 'agents/openai.yaml') continue; // Codex UI metadata
    if (referenced.has(norm(f))) continue;
    if ([...referencedDirs].some((d) => norm(f).startsWith(d + sep))) continue;
    if (allText.includes(rel) || allText.includes(path.basename(f))) continue;
    if (importedByOtherCode(f)) continue;
    // Files inside a folder that is referenced by name ("schemas/", or "schemas" in code) are loaded as a group.
    const parents = rel.split('/').slice(0, -1);
    if (parents.some((seg) => !['scripts', 'references', 'reference', 'assets'].includes(seg) && (allText.includes(`${seg}/`) || code.some(([, c]) => c.includes(`"${seg}"`) || c.includes(`'${seg}'`))))) continue;
    unreferenced.push(rel);
  }
  if (!unreferenced.length) return;
  const groups = new Map();
  for (const rel of unreferenced) {
    const top = rel.includes('/') ? rel.split('/')[0] : '';
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(rel);
  }
  for (const [top, list] of groups) {
    const totalInTop = top ? files.filter((f) => toPosix(path.relative(dir, f)).startsWith(`${top}/`)).length : 0;
    if (top && list.length > 1 && list.length === totalInTop && !allText.includes(`${top}/`)) {
      ctx.report('unreferenced-file', {
        file,
        line: 1,
        message: `${top}/ (${list.length} files) is never mentioned in SKILL.md, so the agent will not know it exists.`,
        hint: `Tell the agent when to use it, e.g. "See ${top}/... for ...", or delete it.`,
      });
    } else if (list.length > 3) {
      ctx.report('unreferenced-file', {
        file,
        line: 1,
        message: `${list.length} files${top ? ` under ${top}/` : ''} are never mentioned by name (e.g. ${list.slice(0, 3).join(', ')}).`,
        hint: 'Mention the files (or their folder) where the agent should use them, or delete the unused ones.',
      });
    } else {
      for (const rel of list) {
        ctx.report('unreferenced-file', {
          file,
          line: 1,
          message: `${rel} is never mentioned in SKILL.md or its references, so the agent will not know it exists.`,
          hint: `Reference it (e.g. "Run ${rel}" or "See [${path.basename(rel)}](${rel})"), or delete it.`,
        });
      }
    }
  }
}
function findLine(text, needle) {
  const idx = text.indexOf(needle);
  if (idx === -1) return 1;
  return text.slice(0, idx).split('\n').length;
}

function checkScripts(skill, files, ctx) {
  const { dir } = skill;
  const byStem = new Map();
  for (const f of files) {
    const stem = path.join(path.dirname(f), path.basename(f, path.extname(f))).toLowerCase();
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(path.extname(f).toLowerCase());
  }
  for (const f of files) {
    const rel = toPosix(path.relative(dir, f));
    const ext = path.extname(f).toLowerCase();
    const inScripts = rel.startsWith('scripts/') || rel.startsWith('bin/');
    const git = gitFileInfo(f);
    let executable = null;
    if (git) executable = git.mode === '100755';
    else if (process.platform !== 'win32') {
      try {
        executable = (fs.statSync(f).mode & 0o111) !== 0;
      } catch {
        executable = null;
      }
    }
    const isShell = SHELL_EXT.has(ext);
    const noExt = ext === '' && inScripts;
    if (!(inScripts || isShell || executable)) continue;
    if (WINDOWS_SCRIPT_EXT.has(ext)) {
      const stem = path.join(path.dirname(f), path.basename(f, path.extname(f))).toLowerCase();
      const siblings = (byStem.get(stem) || []).filter((e) => !WINDOWS_SCRIPT_EXT.has(e));
      if (!siblings.length) {
        ctx.report('script-windows-only', {
          file: f,
          line: 1,
          message: `${rel} is a Windows-only script with no .sh/.py/.js equivalent; agents on macOS and Linux cannot run it.`,
          hint: 'Provide a cross-platform version (Python or Node.js work everywhere), or document the Windows requirement in `compatibility`.',
        });
      }
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(f);
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;
    const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '');
    const shebang = head.startsWith('#!');
    if (!shebang && (isShell || noExt || executable)) {
      ctx.report('script-no-shebang', {
        file: f,
        line: 1,
        message: `${rel} ${executable ? 'is executable' : 'is a shell script'} but has no #! shebang line, so running it directly fails or uses the wrong interpreter.`,
        hint: isShell || noExt ? 'Add "#!/usr/bin/env bash" (or the right interpreter) as the first line.' : 'Add a shebang such as "#!/usr/bin/env python3", or clear the executable bit.',
      });
    }
    if (shebang && executable === false) {
      ctx.report('script-not-executable', {
        file: f,
        line: 1,
        message: `${rel} has a shebang but is not executable, so "./${rel}" fails with "permission denied".`,
        hint: `Run: git update-index --chmod=+x ${rel}  (or chmod +x ${rel})`,
        fix: process.platform !== 'win32' ? { kind: 'chmod' } : undefined,
      });
    }
    if (shebang) {
      const crlf = git && git.eol ? git.eol === 'crlf' || git.eol === 'mixed' : buf.includes('\r\n');
      if (crlf) {
        ctx.report('script-crlf', {
          file: f,
          line: 1,
          message: `${rel} has CRLF line endings; on Linux/macOS the shebang becomes "${head.split('\n')[0].replace(/\r$/, '')}\\r" and the script fails with "bad interpreter".`,
          hint: 'Convert to LF and add "*.sh text eol=lf" (or "* text=auto eol=lf") to .gitattributes.',
          fix: { kind: 'text', apply: (t) => t.replace(/\r\n/g, '\n') },
        });
      }
    }
  }
}

function checkLayout(skill, ctx, R) {
  const rel = toPosix(path.relative(ctx.cwd, skill.dir));
  const segments = toPosix(path.resolve(skill.dir)).split('/');
  // nesting depth below the nearest "skills" directory
  const idx = segments.lastIndexOf('skills');
  if (idx !== -1 && idx < segments.length - 1) {
    const depth = segments.length - 1 - idx;
    if (depth > 1) {
      const skillsDir = segments.slice(0, idx + 1).join('/');
      R('skill-nesting-depth', {
        line: 1,
        message: `The skill is ${depth} levels below ${path.basename(skillsDir)}/ (${segments.slice(idx + 1).join('/')}); Claude Code and Gemini CLI only look for skills/<name>/SKILL.md.`,
        hint: `Move it to ${segments[idx]}/${path.basename(skill.dir)}/SKILL.md (Codex scans recursively, the others do not).`,
      });
    }
  }
  // which agents scan this location?
  const m = /(?:^|\/)(\.(?:claude|agents|codex|cursor|gemini|github)\/skills)\//.exec(`${rel}/`);
  if (m) {
    const root = m[1];
    const missing = ctx.targets.filter((t) => t !== 'spec' && !AGENTS[t].projectDirs.includes(root));
    if (missing.length) {
      const readers = ctx.targets.filter((t) => t !== 'spec' && AGENTS[t].projectDirs.includes(root));
      R('skill-location', {
        line: 1,
        affects: missing,
        message: `Skills in ${root}/ are not discovered by ${labelList(missing)}${readers.length ? ` (only by ${labelList(readers)})` : ''}.`,
        hint: missing.includes('claude') ? 'Claude Code reads only .claude/skills; other agents share .agents/skills. Mirror the skill (or symlink it) if you need both.' : 'Use .agents/skills, which Codex, Cursor, Gemini CLI and Copilot all read, or mirror the skill there.',
      });
    }
  }
}

export const __test = { nameProblems };
