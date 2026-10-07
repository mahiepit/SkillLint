// Output formats: stylish (human), json, github (Actions annotations), sarif.
import fs from 'node:fs';
import path from 'node:path';
import { RULES, RULE_MAP, ruleDocsUrl } from '../rules/registry.js';
import { summarize } from '../linter.js';
import { labelList } from '../targets.js';
import { toPosix } from '../fsutil.js';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export const FORMATS = ['stylish', 'json', 'github', 'sarif'];

function relPath(file, cwd) {
  const r = path.relative(cwd, file);
  return toPosix(r.startsWith('..') || path.isAbsolute(r) ? file : r);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function scanned(stats) {
  const parts = [plural(stats.skills, 'skill')];
  const manifests = stats.plugins + stats.marketplaces;
  if (manifests) parts.push(plural(manifests, 'plugin manifest'));
  return parts.join(', ');
}

export function makeColors(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
    green: wrap(32, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
    underline: wrap(4, 24),
  };
}

export function formatStylish(result, { color = false, quiet = false } = {}) {
  const c = makeColors(color);
  const findings = quiet ? result.findings.filter((f) => f.severity === 'error') : result.findings;
  const out = [];
  const byFile = new Map();
  for (const f of findings) {
    const key = relPath(f.file, result.cwd);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(f);
  }
  for (const [file, list] of byFile) {
    out.push(c.underline(file));
    const posWidth = Math.max(...list.map((f) => `${f.line}:${f.column}`.length));
    for (const f of list) {
      const pos = `${f.line}:${f.column}`.padEnd(posWidth);
      const sev = f.severity === 'error' ? c.red('error  ') : f.severity === 'warning' ? c.yellow('warning') : c.cyan('info   ');
      out.push(`  ${c.dim(pos)}  ${sev}  ${f.message}  ${c.dim(f.ruleId)}`);
      if (f.hint) {
        const pad = ' '.repeat(posWidth + 2 + 2 + 7 + 2);
        const lines = f.hint.split('\n');
        out.push(`${pad}${c.dim(`fix: ${lines[0]}`)}`);
        for (const l of lines.slice(1)) out.push(`${pad}${c.dim(`     ${l}`)}`);
      }
    }
    out.push('');
  }
  for (const p of result.problems || []) out.push(c.yellow(`! ${p}`));
  const s = summarize(result.findings);
  const total = s.errors + s.warnings + s.infos;
  if (result.fixed) out.push(c.green(`✔ Fixed ${plural(result.fixed, 'problem')}.`));
  if (total === 0) {
    out.push(c.green(`✔ No problems found in ${scanned(result.stats)}.`));
  } else {
    const line = `${s.errors ? '✖' : '⚠'} ${plural(total, 'problem')} (${plural(s.errors, 'error')}, ${plural(s.warnings, 'warning')}, ${s.infos} info) in ${scanned(result.stats)}.`;
    out.push(s.errors ? c.red(c.bold(line)) : c.yellow(c.bold(line)));
    if (s.fixable) out.push(c.dim(`  ${plural(s.fixable, 'problem')} can be fixed automatically with --fix.`));
  }
  out.push(c.dim(`  Targets: ${labelList(result.targets)}. Rule docs: https://github.com/mahiepit/SkillLint/blob/main/docs/RULES.md`));
  return out.join('\n') + '\n';
}

function cleanFinding(f, cwd) {
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    file: relPath(f.file, cwd),
    line: f.line,
    column: f.column,
    message: f.message,
    hint: f.hint || null,
    fixable: f.fixable,
    affects: f.affects,
    docs: ruleDocsUrl(f.ruleId),
  };
}

export function formatJson(result) {
  const s = summarize(result.findings);
  return (
    JSON.stringify(
      {
        tool: { name: 'SkillLint', version: VERSION },
        targets: result.targets,
        scanned: result.stats,
        summary: { errors: s.errors, warnings: s.warnings, infos: s.infos, fixable: s.fixable, fixed: result.fixed || 0 },
        problems: result.problems || [],
        results: result.findings.map((f) => cleanFinding(f, result.cwd)),
      },
      null,
      2,
    ) + '\n'
  );
}

const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function formatGithub(result, { quiet = false } = {}) {
  const out = [];
  const findings = quiet ? result.findings.filter((f) => f.severity === 'error') : result.findings;
  for (const f of findings) {
    const cmd = f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
    const props = `file=${escProp(relPath(f.file, result.cwd))},line=${f.line},col=${f.column},title=${escProp(`SkillLint ${f.ruleId}`)}`;
    out.push(`::${cmd} ${props}::${escData(f.message + (f.hint ? `\nFix: ${f.hint}` : ''))}`);
  }
  for (const p of result.problems || []) out.push(`::warning::${escData(p)}`);
  const s = summarize(result.findings);
  out.push(`SkillLint: ${s.errors} errors, ${s.warnings} warnings, ${s.infos} info in ${scanned(result.stats)} (targets: ${result.targets.join(', ')}).`);
  return out.join('\n') + '\n';
}

/** Markdown summary for $GITHUB_STEP_SUMMARY. */
export function formatMarkdownSummary(result) {
  const s = summarize(result.findings);
  const lines = [`### SkillLint`, '', `${s.errors ? '❌' : '✅'} **${s.errors} errors**, ${s.warnings} warnings, ${s.infos} info in ${scanned(result.stats)}.`, ''];
  const shown = result.findings.filter((f) => f.severity !== 'info').slice(0, 50);
  if (shown.length) {
    lines.push('| Severity | File | Rule | Message |', '|---|---|---|---|');
    for (const f of shown) {
      const msg = f.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${f.severity} | \`${relPath(f.file, result.cwd)}:${f.line}\` | [${f.ruleId}](${ruleDocsUrl(f.ruleId)}) | ${msg} |`);
    }
    if (result.findings.filter((f) => f.severity !== 'info').length > shown.length) lines.push('', '_Showing the first 50 problems._');
  }
  return lines.join('\n') + '\n';
}

export function formatSarif(result) {
  const rules = RULES.map((r) => ({
    id: r.id,
    name: r.id
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(''),
    shortDescription: { text: r.summary },
    helpUri: ruleDocsUrl(r.id),
    defaultConfiguration: { level: r.severity === 'info' ? 'note' : r.severity },
    properties: { tags: ['agent-skills', ...r.targets] },
  }));
  const index = new Map(RULES.map((r, i) => [r.id, i]));
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'SkillLint', version: VERSION, informationUri: 'https://github.com/mahiepit/SkillLint', rules } },
        results: result.findings.map((f) => ({
          ruleId: f.ruleId,
          ruleIndex: index.get(f.ruleId),
          level: f.severity === 'info' ? 'note' : f.severity,
          message: { text: f.message + (f.hint ? ` Fix: ${f.hint.replace(/\n/g, ' ')}` : '') },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: relPath(f.file, result.cwd) },
                region: { startLine: f.line, startColumn: f.column },
              },
            },
          ],
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + '\n';
}

export function formatRuleList({ color = false, markdown = false } = {}) {
  const c = makeColors(color);
  const cols = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'spec'];
  if (markdown) {
    const lines = ['| Rule | Severity | Fix | Claude Code | Codex | Cursor | Gemini CLI | Copilot | Spec |', '|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|'];
    for (const r of RULES) {
      const marks = cols.map((t) => (r.computedTargets ? '±' : r.targets.includes(t) ? '●' : ''));
      lines.push(`| [\`${r.id}\`](#${r.id}) | ${r.severity} | ${r.fixable ? '🔧' : ''} | ${marks.join(' | ')} |`);
    }
    return lines.join('\n') + '\n';
  }
  const width = Math.max(...RULES.map((r) => r.id.length));
  const out = [`${'RULE'.padEnd(width)}  SEVERITY  FIX  ${cols.map((t) => t.padEnd(7)).join(' ')}`];
  for (const r of RULES) {
    const marks = cols.map((t) => (r.computedTargets ? '±' : r.targets.includes(t) ? '●' : '·').padEnd(7));
    const sev = r.severity === 'error' ? c.red(r.severity.padEnd(8)) : r.severity === 'warning' ? c.yellow(r.severity.padEnd(8)) : c.cyan(r.severity.padEnd(8));
    out.push(`${r.id.padEnd(width)}  ${sev}  ${r.fixable ? 'yes' : '   '}  ${marks.join(' ')}`);
  }
  out.push('', c.dim('● matters for this target   ± depends on the field / location   Details: docs/RULES.md'));
  return out.join('\n') + '\n';
}

export function ruleInfo(id) {
  return RULE_MAP.get(id);
}
