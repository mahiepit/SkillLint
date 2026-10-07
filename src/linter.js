// Orchestrates discovery, rules, inline disables, fixes and result sorting.
import fs from 'node:fs';
import path from 'node:path';
import { discover } from './discover.js';
import { makeMatcher } from './glob.js';
import { RULE_MAP } from './rules/registry.js';
import { lintSkill, inlineDisables } from './rules/skill.js';
import { lintPluginManifest, lintMarketplace } from './rules/plugin.js';
import { ALL_TARGETS, labelList } from './targets.js';
import { isInside, toPosix } from './fsutil.js';
import { clearGitCache } from './git.js';

/**
 * @typedef {object} Finding
 * @property {string} ruleId
 * @property {'error'|'warning'|'info'} severity
 * @property {string} file absolute path
 * @property {number} line
 * @property {number} column
 * @property {string} message
 * @property {string} [hint]
 * @property {string[]} affects targets this finding matters for (within the selected targets)
 * @property {boolean} fixable
 */

/**
 * Lint skills and plugin manifests.
 * @param {object} options
 * @param {string[]} [options.paths]
 * @param {string} [options.cwd]
 * @param {string[]} [options.targets]
 * @param {Record<string,string>} [options.rules] severity overrides
 * @param {string[]} [options.ignore]
 * @param {boolean} [options.fix]
 */
export function lint(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const targets = options.targets && options.targets.length ? options.targets : [...ALL_TARGETS];
  const overrides = options.rules || {};
  const paths = options.paths && options.paths.length ? options.paths : ['.'];
  const ignoreBases = [cwd, ...(options.ignoreBase ? [options.ignoreBase] : []), ...paths.map((p) => path.resolve(cwd, p))];
  const matcher = makeMatcher(options.ignore || []);
  const isIgnored = (abs) => {
    if (!options.ignore || !options.ignore.length) return false;
    return ignoreBases.some((b) => isInside(abs, b) && abs !== b && matcher(toPosix(path.relative(b, abs))));
  };

  const run = () => {
    clearGitCache();
    const found = discover(paths, { cwd, isIgnored });
    const findings = [];
    const skillFacts = [];
    const disables = [];

    const makeCtx = (scope) => ({
      cwd,
      targets,
      has: (t) => targets.includes(t),
      report(id, f) {
        const rule = RULE_MAP.get(id);
        if (!rule) throw new Error(`Unknown rule id ${id}`);
        const severity = overrides[id] || rule.severity;
        if (severity === 'off') return;
        const affects = (f.affects || rule.targets).filter((t) => targets.includes(t));
        if (!affects.length) return;
        if (scope && scope.disabled) {
          if (scope.disabled === 'all' || scope.disabled.has(id)) return;
        }
        findings.push({
          ruleId: id,
          severity,
          file: f.file,
          line: f.line || 1,
          column: f.column || 1,
          message: f.message,
          hint: f.hint,
          affects,
          fixable: Boolean(f.fix),
          fix: f.fix,
        });
      },
    });

    for (const s of found.skills) {
      let text;
      try {
        text = fs.readFileSync(s.file, 'utf8');
      } catch (err) {
        found.problems.push(`${s.file}: ${err.message}`);
        continue;
      }
      const scope = { disabled: inlineDisables(text) };
      disables.push({ dir: s.dir, disabled: scope.disabled });
      const isPluginRoot = fs.existsSync(path.join(s.dir, '.claude-plugin'));
      const facts = lintSkill({ ...s, text, isPluginRoot }, makeCtx(scope));
      skillFacts.push({ ...s, ...facts, scope });
    }

    // Cross-skill: duplicate names
    const byName = new Map();
    for (const s of skillFacts) {
      if (!s.name) continue;
      if (!byName.has(s.name)) byName.set(s.name, []);
      byName.get(s.name).push(s);
    }
    for (const [name, list] of byName) {
      if (list.length < 2) continue;
      for (const s of list) {
        const others = list.filter((o) => o !== s).map((o) => toPosix(path.relative(cwd, o.file)));
        makeCtx(s.scope).report('duplicate-skill-name', {
          file: s.file,
          line: 1,
          message: `Skill name "${name}" is also used by ${others.join(', ')}; an agent that loads both keeps only one.`,
          hint: 'Give each skill a unique name, or keep a single copy (symlink mirrors instead of duplicating).',
        });
      }
    }

    for (const p of found.plugins) lintPluginManifest(p, makeCtx(null));
    for (const m of found.marketplaces) lintMarketplace(m, makeCtx(null));

    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.ruleId.localeCompare(b.ruleId));
    return {
      findings,
      problems: found.problems,
      stats: { skills: found.skills.length, plugins: found.plugins.length, marketplaces: found.marketplaces.length },
    };
  };

  let result = run();
  let fixed = 0;
  if (options.fix) {
    fixed = applyFixes(result.findings);
    if (fixed) result = run();
  }
  return { ...result, fixed, targets, cwd };
}

/** Apply the fixes attached to findings. Returns the number of fixes applied. */
export function applyFixes(findings) {
  const byFile = new Map();
  for (const f of findings) {
    if (!f.fix) continue;
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f.fix);
  }
  let count = 0;
  for (const [file, fixes] of byFile) {
    let text = null;
    let original = null;
    for (const fix of fixes) {
      if (fix.kind === 'chmod') {
        try {
          const mode = fs.statSync(file).mode;
          fs.chmodSync(file, mode | 0o111);
          count++;
        } catch {
          /* ignore */
        }
        continue;
      }
      if (fix.kind === 'text') {
        if (text === null) {
          text = fs.readFileSync(file, 'utf8');
          original = text;
        }
        const next = fix.apply(text);
        if (next !== text) {
          text = next;
          count++;
        }
      }
    }
    if (text !== null && text !== original) fs.writeFileSync(file, text, 'utf8');
  }
  return count;
}

export function summarize(findings) {
  const s = { errors: 0, warnings: 0, infos: 0, fixable: 0 };
  for (const f of findings) {
    if (f.severity === 'error') s.errors++;
    else if (f.severity === 'warning') s.warnings++;
    else s.infos++;
    if (f.fixable) s.fixable++;
  }
  return s;
}

export function describeTargets(targets) {
  return labelList(targets);
}
