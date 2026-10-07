import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cli, FIXTURES, ROOT, tempDir, write, skillMd } from './_helpers.js';
import { RULES } from '../src/rules/registry.js';
import { parseArgs } from '../src/cli.js';

const fx = (name) => path.join(FIXTURES, name);

test('exit code 0 for a valid skill, 1 for errors', () => {
  const ok = cli([], { cwd: fx('valid') });
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /No problems found in 1 skill/);
  const bad = cli([], { cwd: fx('invalid-yaml') });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /frontmatter-invalid-yaml/);
  assert.match(bad.out, /colon-skill\/SKILL\.md/);
  assert.match(bad.out, /1 error/);
});

test('warnings do not fail unless --strict or --max-warnings', () => {
  assert.equal(cli([], { cwd: fx('person') }).code, 0);
  assert.equal(cli(['--strict'], { cwd: fx('person') }).code, 1);
  assert.equal(cli(['--max-warnings', '0'], { cwd: fx('person') }).code, 1);
  assert.equal(cli(['--max-warnings=1'], { cwd: fx('person') }).code, 0);
});

test('usage errors exit with 2', () => {
  assert.equal(cli(['--nope']).code, 2);
  assert.equal(cli(['--target', 'vim']).code, 2);
  assert.equal(cli(['--format', 'xml']).code, 2);
  assert.equal(cli(['--rule', 'not-a-rule=off']).code, 2);
  const missing = cli(['does-not-exist'], { cwd: fx('valid') });
  assert.equal(missing.code, 2);
  assert.match(missing.out, /no such file/);
});

test('--json output', () => {
  const r = cli(['--json'], { cwd: fx('links') });
  const data = JSON.parse(r.out);
  assert.equal(data.tool.name, 'SkillLint');
  assert.equal(data.summary.errors, 2);
  assert.equal(data.scanned.skills, 1);
  const f = data.results.find((x) => x.ruleId === 'link-broken');
  assert.equal(f.file, 'broken-links/SKILL.md');
  assert.ok(f.line > 0 && f.column > 0);
  assert.match(f.docs, /RULES\.md#link-broken$/);
  assert.equal('fix' in f, false);
});

test('--format github prints workflow commands and writes outputs + step summary', () => {
  const dir = tempDir();
  const summary = path.join(dir, 'summary.md');
  const output = path.join(dir, 'output.txt');
  const r = cli(['--format', 'github'], { cwd: fx('links'), env: { GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output } });
  assert.equal(r.code, 1);
  const lines = r.out.trim().split('\n');
  assert.ok(lines.some((l) => /^::error file=broken-links\/SKILL\.md,line=\d+,col=\d+,title=SkillLint link-broken::/.test(l)));
  assert.ok(lines.some((l) => l.startsWith('::warning ')));
  assert.ok(lines.some((l) => l.startsWith('::notice ')));
  assert.ok(!lines.some((l) => l.startsWith('::') && /\n/.test(l)));
  assert.match(fs.readFileSync(summary, 'utf8'), /### SkillLint/);
  assert.match(fs.readFileSync(output, 'utf8'), /errors=2\nwarnings=\d+\ninfos=\d+/);
});

test('--format sarif and --sarif <file>', () => {
  const r = cli(['--format', 'sarif'], { cwd: fx('links') });
  const sarif = JSON.parse(r.out);
  assert.equal(sarif.version, '2.1.0');
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.rules.length, RULES.length);
  const res = run.results.find((x) => x.ruleId === 'link-broken');
  assert.equal(res.level, 'error');
  assert.equal(run.tool.driver.rules[res.ruleIndex].id, 'link-broken');
  assert.equal(res.locations[0].physicalLocation.artifactLocation.uri, 'broken-links/SKILL.md');

  const dir = tempDir();
  write(dir, 'x/SKILL.md', skillMd({ name: 'x-skill' }));
  const r2 = cli(['--sarif', 'out.sarif'], { cwd: dir });
  assert.equal(r2.code, 1);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'out.sarif'), 'utf8')).runs);
});

test('--target narrows the checks', () => {
  assert.equal(cli(['--target', 'claude'], { cwd: fx('claude-syntax') }).out.includes('agent-specific-syntax'), false);
  assert.equal(cli(['--target', 'codex'], { cwd: fx('claude-syntax') }).out.includes('agent-specific-syntax'), true);
  assert.match(cli(['-t', 'claude-code,openai'], { cwd: fx('valid') }).out, /Targets: Claude Code, OpenAI Codex\./);
});

test('--quiet shows only errors; --rule overrides', () => {
  const q = cli(['--quiet'], { cwd: fx('links') });
  assert.ok(!q.out.includes('warning  '));
  const off = cli(['--rule', 'description-person=off'], { cwd: fx('person') });
  assert.match(off.out, /No problems found/);
  const err = cli(['--rule', 'description-person=error'], { cwd: fx('person') });
  assert.equal(err.code, 1);
});

test('config file: targets, rules and ignore', () => {
  const dir = tempDir();
  write(dir, 'skills/person/SKILL.md', skillMd({ name: 'person', description: 'I can help you plan trips. Use when the user asks about travel plans or itineraries.' }));
  write(dir, 'vendor/broken/SKILL.md', '# no frontmatter\n');
  write(dir, '.skilllintrc.json', JSON.stringify({ targets: ['claude'], rules: { 'description-person': 'error' }, ignore: ['vendor'] }));
  const r = cli(['--json'], { cwd: dir });
  const data = JSON.parse(r.out);
  assert.deepEqual(data.targets, ['claude']);
  assert.equal(data.scanned.skills, 1);
  assert.equal(data.results[0].severity, 'error');
  assert.equal(r.code, 1);
  assert.equal(cli(['--no-config'], { cwd: dir }).code, 1);
  write(dir, 'bad.json', '{"rules": {"nope": "off"}}');
  assert.equal(cli(['--config', 'bad.json'], { cwd: dir }).code, 2);
});

test('--fix reports what it fixed', () => {
  const dir = tempDir('bad-name');
  const r = cli(['--fix'], { cwd: dir });
  assert.equal(r.code, 0);
  assert.match(r.out, /Fixed 1 problem/);
});

test('--list-rules, --help and --version', () => {
  const list = cli(['--list-rules']);
  for (const rule of RULES) assert.ok(list.out.includes(rule.id), rule.id);
  assert.match(cli(['--help']).out, /Usage/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(cli(['--version']).out.trim(), pkg.version);
});

test('parseArgs handles repeated and inline options', () => {
  const o = parseArgs(['a', '--ignore', 'x/**', '--ignore=y', '--rule', 'name-vague=off', '-t', 'claude', 'b']);
  assert.deepEqual(o.paths, ['a', 'b']);
  assert.deepEqual(o.ignore, ['x/**', 'y']);
  assert.deepEqual(o.rules, { 'name-vague': 'off' });
  assert.deepEqual(o.targets, ['claude']);
  assert.throws(() => parseArgs(['--sarif']), /needs a value/);
  assert.deepEqual(parseArgs(['--json', '--', '--odd-dir', 'x']).paths, ['--odd-dir', 'x']);
});

test('the bin script runs as a real process', () => {
  const bin = path.join(ROOT, 'bin', 'skilllint.js');
  const ok = spawnSync(process.execPath, [bin, fx('valid')], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(ok.status, 0, ok.stderr);
  const bad = spawnSync(process.execPath, [bin, fx('no-frontmatter')], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /frontmatter-missing/);
});
