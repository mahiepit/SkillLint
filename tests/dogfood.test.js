// SkillLint lints its own repository: the bundled skill and plugin manifests
// must be clean, and every rule must be documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lint } from '../src/linter.js';
import { loadConfig } from '../src/config.js';
import { RULES } from '../src/rules/registry.js';
import { ROOT, FIXTURES, cli } from './_helpers.js';

test('the example output in README.md is real, current CLI output', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const extra of [[], ['--target', 'claude']]) {
    const r = cli(['fields', 'invalid-yaml', 'codex-description', ...extra], { cwd: FIXTURES });
    assert.ok(readme.includes(r.out.trim()), `README example is out of date for args ${extra.join(' ') || '(none)'}:\n${r.out}`);
  }
});

test('the repository passes its own linter with no errors or warnings', () => {
  const config = loadConfig(path.join(ROOT, '.skilllintrc.json'));
  const r = lint({ cwd: ROOT, ignore: config.ignore, ignoreBase: config.dir });
  const problems = r.findings.map((f) => `${path.relative(ROOT, f.file)}:${f.line} ${f.ruleId} ${f.message}`);
  assert.deepEqual(problems, []);
  assert.ok(r.stats.skills >= 1, 'finds the bundled skill');
  assert.equal(r.stats.plugins, 1);
  assert.equal(r.stats.marketplaces, 1);
});

test('every rule is documented in docs/RULES.md with a source link', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'RULES.md'), 'utf8');
  for (const rule of RULES) {
    const heading = new RegExp(`^### \`${rule.id}\``, 'm');
    assert.match(doc, heading, `docs/RULES.md is missing a section for ${rule.id}`);
    const section = doc.split(heading)[1].split(/^### /m)[0];
    assert.match(section, /https:\/\//, `${rule.id} section has no source link`);
  }
});

test('rule ids are unique, kebab-case and have valid metadata', () => {
  const ids = new Set();
  for (const r of RULES) {
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`);
    ids.add(r.id);
    assert.match(r.id, /^[a-z]+(-[a-z]+)*$/);
    assert.ok(['error', 'warning', 'info'].includes(r.severity));
    assert.ok(r.targets.length > 0);
    assert.ok(r.sources.length > 0);
  }
});

test('package.json, plugin.json and marketplace.json agree on the version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.version, pkg.version);
  const skill = fs.readFileSync(path.join(ROOT, 'skills', 'writing-agent-skills', 'SKILL.md'), 'utf8');
  assert.match(skill, new RegExp(`version: "${pkg.version.replace(/\./g, '\\.')}"`));
});
