import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lint } from '../src/linter.js';
import { lintFixture, uniq, tempDir, write, skillMd, GOOD_DESC, FIXTURES } from './_helpers.js';

const idsOf = (r) => r.findings.map((f) => f.ruleId).sort();

test('a valid skill has no findings for any target', () => {
  const r = lintFixture('valid');
  assert.deepEqual(r.findings, []);
  assert.equal(r.stats.skills, 1);
});

test('name-format is reported and fixable when the kebab-case name matches the folder', () => {
  const r = lintFixture('bad-name');
  assert.deepEqual(r.ids, ['name-format']);
  assert.equal(r.findings[0].fixable, true);
  assert.equal(r.findings[0].line, 2);

  const dir = tempDir('bad-name');
  const fixed = lint({ cwd: dir, fix: true });
  assert.equal(fixed.fixed, 1);
  assert.deepEqual(fixed.findings, []);
  assert.match(fs.readFileSync(path.join(dir, 'pdf-tools', 'SKILL.md'), 'utf8'), /^name: pdf-tools$/m);
});

test('name-format is not auto-fixed when the result would not match the folder', () => {
  const dir = tempDir();
  write(dir, 'other-dir/SKILL.md', skillMd({ name: 'My Skill' }));
  const r = lint({ cwd: dir });
  const f = r.findings.find((x) => x.ruleId === 'name-format');
  assert.ok(f);
  assert.equal(f.fixable, false);
  assert.ok(r.findings.some((x) => x.ruleId === 'name-dir-mismatch'));
});

test('name-dir-mismatch', () => {
  assert.deepEqual(lintFixture('name-mismatch').ids, ['name-dir-mismatch']);
  // Claude Code and Codex do not require the match
  assert.deepEqual(lintFixture('name-mismatch', { targets: ['claude', 'codex'] }).ids, []);
});

test('frontmatter-missing, including frontmatter that does not start on line 1', () => {
  assert.deepEqual(lintFixture('no-frontmatter').ids, ['frontmatter-missing']);
  const late = lintFixture('late-frontmatter');
  assert.deepEqual(late.ids, ['frontmatter-missing']);
  assert.equal(late.findings[0].line, 3);
  assert.match(late.findings[0].message, /line 3/);
});

test('frontmatter-invalid-yaml points at the offending colon', () => {
  const r = lintFixture('invalid-yaml');
  assert.deepEqual(r.ids, ['frontmatter-invalid-yaml']);
  assert.equal(r.findings[0].line, 3);
  assert.match(r.findings[0].hint, /quot/i);
});

test('frontmatter-unterminated and non-mapping frontmatter', () => {
  const dir = tempDir();
  write(dir, 'open-ended/SKILL.md', '---\nname: open-ended\ndescription: x\n');
  write(dir, 'scalar-fm/SKILL.md', '---\njust a sentence\n---\n\nBody\n');
  const r = lint({ cwd: dir });
  const ids = idsOf(r);
  assert.ok(ids.includes('frontmatter-unterminated'));
  assert.ok(ids.includes('frontmatter-invalid-yaml'));
});

test('description length limits differ per agent', () => {
  assert.deepEqual(lintFixture('long-description').ids, ['description-too-long', 'description-too-long-codex']);
  assert.deepEqual(lintFixture('codex-description').ids, ['description-too-long-codex']);
  assert.deepEqual(lintFixture('codex-description', { targets: ['claude', 'cursor'] }).ids, []);
  assert.deepEqual(lintFixture('long-description', { targets: ['codex'] }).ids, ['description-too-long-codex']);
});

test('vague names and descriptions', () => {
  assert.deepEqual(lintFixture('vague').ids, ['description-no-trigger', 'description-too-short', 'name-vague']);
});

test('description-person and description-xml-tags', () => {
  assert.deepEqual(lintFixture('person').ids, ['description-person']);
  assert.deepEqual(lintFixture('xml-desc').ids, ['description-xml-tags']);
  assert.deepEqual(lintFixture('xml-desc', { targets: ['codex', 'gemini'] }).ids, []);
});

test('missing name and description', () => {
  const dir = tempDir();
  write(dir, 'no-name/SKILL.md', `---\ndescription: ${GOOD_DESC}\n---\n\nBody\n`);
  write(dir, 'no-desc/SKILL.md', '---\nname: no-desc\n---\n\nBody\n');
  write(dir, 'empty-desc/SKILL.md', '---\nname: empty-desc\ndescription: ""\n---\n\nBody\n');
  const r = lint({ cwd: dir });
  assert.deepEqual(idsOf(r), ['description-missing', 'description-missing', 'name-missing']);
  // Claude Code tolerates both (directory name / first paragraph fallbacks)
  assert.deepEqual(idsOf(lint({ cwd: dir, targets: ['claude'] })), []);
});

test('name too long, numeric name, reserved word', () => {
  const dir = tempDir();
  const long = 'a'.repeat(70);
  write(dir, `${long}/SKILL.md`, skillMd({ name: long }));
  write(dir, '2048/SKILL.md', skillMd({ name: '2048' }).replace('name: 2048', 'name: 2048'));
  write(dir, 'claude-helper/SKILL.md', skillMd({ name: 'claude-helper' }));
  const ids = idsOf(lint({ cwd: dir }));
  assert.ok(ids.includes('name-too-long'));
  assert.ok(ids.includes('field-type'));
  assert.ok(ids.includes('name-reserved-word'));
});

test('field rules: unknown, non-portable, types, metadata, compatibility, allowed-tools', () => {
  const r = lintFixture('fields');
  assert.deepEqual(uniq(r.ids), ['allowed-tools-format', 'compatibility-invalid', 'field-type', 'metadata-invalid', 'non-portable-field', 'unknown-field']);
  const unknown = r.findings.find((f) => f.ruleId === 'unknown-field');
  assert.match(unknown.message, /did you mean `license`/);
  assert.equal(r.findings.filter((f) => f.ruleId === 'non-portable-field').length, 4);
  const meta = r.findings.find((f) => f.ruleId === 'metadata-invalid');
  assert.match(meta.hint, /"1\.0"/);

  // For a Claude Code-only skill, the Claude fields are fine but bad values are still errors.
  const claude = lintFixture('fields', { targets: ['claude'] });
  assert.deepEqual(uniq(claude.ids), ['field-type', 'unknown-field']);
  // For Cursor, Claude-only fields are flagged and Cursor-only ones are not.
  const cursor = lintFixture('fields', { targets: ['cursor'] });
  assert.ok(cursor.findings.filter((f) => f.ruleId === 'non-portable-field').every((f) => f.affects.includes('cursor')));
});

test('a field supported by every selected target is not reported', () => {
  const dir = tempDir();
  write(dir, 'paths-skill/SKILL.md', skillMd({ name: 'paths-skill', extra: 'paths: "src/**/*.ts"\ndisable-model-invocation: true\n' }));
  assert.deepEqual(idsOf(lint({ cwd: dir, targets: ['claude', 'cursor'] })), []);
  assert.deepEqual(uniq(idsOf(lint({ cwd: dir, targets: ['codex'] }))), ['non-portable-field']);
});

test('license-file-missing and yaml-gotcha', () => {
  assert.deepEqual(lintFixture('license').ids, ['license-file-missing']);
  const g = lintFixture('yaml-gotcha');
  assert.deepEqual(g.ids, ['yaml-gotcha']);
  assert.match(g.findings[0].message, /#triage/);
});

test('links, paths, case mismatches, absolute and Windows paths', () => {
  const r = lintFixture('links');
  assert.deepEqual(r.ids, [
    'absolute-path',
    'absolute-path',
    'link-broken',
    'link-broken',
    'link-escapes-skill',
    'nested-reference',
    'path-reference-missing',
    'unreferenced-file',
    'windows-path',
  ]);
  const caseMismatch = r.findings.find((f) => f.ruleId === 'link-broken' && /letter case/.test(f.message));
  assert.ok(caseMismatch, 'reports links that only match with different letter case');
  const nested = r.findings.find((f) => f.ruleId === 'nested-reference');
  assert.match(nested.file.replace(/\\/g, '/'), /references\/present\.md$/);
});

test('links inside code blocks are ignored, bare paths in code are checked', () => {
  const dir = tempDir();
  write(dir, 'code-skill/SKILL.md', skillMd({ name: 'code-skill', body: '# T\n\n```md\n[x](missing.md)\n```\n\n`[y](also-missing.md)`\n\n```bash\npython scripts/nope.py\n```\n' }));
  assert.deepEqual(idsOf(lint({ cwd: dir })), ['path-reference-missing']);
});

test('path heuristics: missing extension, prose, globs, examples and placeholder links', () => {
  const dir = tempDir();
  const body = [
    '# T',
    '',
    'Run `python scripts/check_fields <file.pdf>` first.',
    'Better scripts/tools would help.',
    'Copy a skeleton from `references/layouts*.md` or `scripts/<name>.py`.',
    '- **Examples**: `references/finance.md` for finance schemas',
    'See [the source](URL) and [docs](path/to/file.md).',
    '',
  ].join('\n');
  write(dir, 'heur-skill/SKILL.md', skillMd({ name: 'heur-skill', body }));
  write(dir, 'heur-skill/scripts/check_fields.py', 'print(1)\n');
  const r = lint({ cwd: dir });
  assert.deepEqual(idsOf(r), ['path-reference-missing']);
  assert.match(r.findings[0].message, /did you mean "scripts\/check_fields\.py"/);
});

test('many unreferenced files are summarized in one finding', () => {
  const dir = tempDir();
  write(dir, 'many-files/SKILL.md', skillMd({ name: 'many-files', body: '# T\n\nUse assets/logo.png in the header. Run scripts/build.py.\n' }));
  write(dir, 'many-files/assets/logo.png', 'png');
  for (let i = 0; i < 5; i++) write(dir, `many-files/assets/icon${i}.svg`, '<svg/>');
  // A module imported by a referenced script and a folder loaded by name count as used.
  write(dir, 'many-files/scripts/build.py', 'from helpers import render\nSCHEMAS = "schemas"\n');
  write(dir, 'many-files/scripts/helpers.py', 'def render(): pass\n');
  write(dir, 'many-files/scripts/schemas/a.xsd', '<xs/>');
  const r = lint({ cwd: dir });
  const un = r.findings.filter((f) => f.ruleId === 'unreferenced-file');
  assert.equal(un.length, 1);
  assert.match(un[0].message, /5 files under assets\//);
});

test('reference-no-toc and time-sensitive', () => {
  assert.deepEqual(lintFixture('reference-toc').ids, ['reference-no-toc', 'time-sensitive']);
});

test('unreferenced files are grouped by directory', () => {
  const dir = tempDir();
  write(dir, 'grouped/SKILL.md', skillMd({ name: 'grouped' }));
  write(dir, 'grouped/assets/a.png', 'x');
  write(dir, 'grouped/assets/b.png', 'x');
  write(dir, 'grouped/LICENSE.txt', 'MIT');
  write(dir, 'grouped/agents/openai.yaml', 'interface: {}\n');
  const r = lint({ cwd: dir });
  assert.deepEqual(idsOf(r), ['unreferenced-file']);
  assert.match(r.findings[0].message, /assets\/ \(2 files\)/);
});

test('scripts: missing shebang and Windows-only scripts', () => {
  assert.deepEqual(lintFixture('scripts').ids, ['script-no-shebang', 'script-windows-only']);
});

test('script-crlf is detected and fixed', () => {
  const dir = tempDir();
  write(dir, 'crlf-script/SKILL.md', skillMd({ name: 'crlf-script', body: '# T\n\nRun scripts/run.py.\n' }));
  write(dir, 'crlf-script/scripts/run.py', '#!/usr/bin/env python3\r\nprint("hi")\r\n');
  const r = lint({ cwd: dir });
  assert.ok(idsOf(r).includes('script-crlf'));
  const fixed = lint({ cwd: dir, fix: true });
  assert.ok(!idsOf(fixed).includes('script-crlf'));
  assert.equal(fs.readFileSync(path.join(dir, 'crlf-script/scripts/run.py'), 'utf8'), '#!/usr/bin/env python3\nprint("hi")\n');
});

const hasGit = spawnSync('git', ['--version']).status === 0;

test('script-not-executable uses the git index', { skip: !hasGit && 'git not available' }, () => {
  const dir = tempDir();
  write(dir, 'exec-skill/SKILL.md', skillMd({ name: 'exec-skill', body: '# T\n\nRun scripts/run.sh.\n' }));
  write(dir, 'exec-skill/scripts/run.sh', '#!/bin/sh\necho hi\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['update-index', '--chmod=-x', 'exec-skill/scripts/run.sh'], { cwd: dir });
  assert.ok(idsOf(lint({ cwd: dir })).includes('script-not-executable'));
  spawnSync('git', ['update-index', '--chmod=+x', 'exec-skill/scripts/run.sh'], { cwd: dir });
  assert.ok(!idsOf(lint({ cwd: dir })).includes('script-not-executable'));
});

test('Claude Code-only body syntax is flagged for other agents only', () => {
  assert.deepEqual(lintFixture('claude-syntax').ids, ['agent-specific-syntax', 'agent-specific-syntax', 'agent-specific-syntax']);
  assert.deepEqual(lintFixture('claude-syntax', { targets: ['claude'] }).ids, []);
});

test('skill-nesting-depth and duplicate-skill-name', () => {
  assert.deepEqual(lintFixture('nested').ids, ['skill-nesting-depth']);
  assert.deepEqual(lintFixture('nested', { targets: ['codex'] }).ids, []);
  assert.deepEqual(lintFixture('duplicates').ids, ['duplicate-skill-name', 'duplicate-skill-name']);
});

test('repo discovery: agent directories, skill.md spelling, skill-location', () => {
  const r = lintFixture('repo');
  assert.equal(r.stats.skills, 3);
  assert.ok(r.ids.includes('skill-md-filename'));
  const loc = r.findings.filter((f) => f.ruleId === 'skill-location');
  assert.equal(loc.length, 3);
  const agentsDir = loc.find((f) => f.file.replace(/\\/g, '/').includes('.agents/skills'));
  assert.deepEqual(agentsDir.affects, ['claude']);
  // With only Codex + Gemini targeted, .agents/skills is fine.
  const r2 = lintFixture('repo', { targets: ['codex', 'gemini'] });
  assert.ok(!r2.findings.some((f) => f.ruleId === 'skill-location' && f.file.replace(/\\/g, '/').includes('.agents/skills')));
});

test('node_modules and ignore globs are skipped', () => {
  const dir = tempDir();
  write(dir, 'node_modules/pkg/skills/x/SKILL.md', '# not a skill\n');
  write(dir, 'vendor/other/SKILL.md', '# not linted\n');
  write(dir, 'real-skill/SKILL.md', skillMd({ name: 'real-skill' }));
  const r = lint({ cwd: dir, ignore: ['vendor/**'] });
  assert.equal(r.stats.skills, 1);
  assert.deepEqual(r.findings, []);
});

test('inline disable comments', () => {
  assert.deepEqual(lintFixture('inline-disable').ids, []);
  const dir = tempDir();
  write(dir, 'utils/SKILL.md', '---\nname: utils\ndescription: Helps with files.\n---\n\n<!-- skilllint-disable -->\nBody\n');
  assert.deepEqual(lint({ cwd: dir }).findings, []);
});

test('body-empty, body-too-long and body-token-budget', () => {
  assert.deepEqual(lintFixture('empty-body').ids, ['body-empty']);
  const dir = tempDir();
  const body = '# Long\n\n' + Array.from({ length: 600 }, (_, i) => `Step ${i}: ${'do the thing carefully and check the output. '.repeat(1)}`).join('\n') + '\n';
  write(dir, 'long-body/SKILL.md', skillMd({ name: 'long-body', body }));
  assert.deepEqual(idsOf(lint({ cwd: dir })), ['body-token-budget', 'body-too-long']);
});

test('BOM, CRLF, trailing whitespace and delimiter problems are fixed by --fix', () => {
  const dir = tempDir();
  const content = '﻿---  \r\nname: fix-me   \r\ndescription: ' + GOOD_DESC + '\r\n---\r\n\r\n# Fix me\r\n\r\nBody.\r\n';
  const file = write(dir, 'fix-me/SKILL.md', content);
  const before = lint({ cwd: dir });
  assert.deepEqual(idsOf(before), ['crlf-line-endings', 'file-bom', 'frontmatter-delimiter', 'trailing-whitespace']);
  const after = lint({ cwd: dir, fix: true });
  assert.ok(after.fixed >= 4);
  assert.deepEqual(after.findings, []);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.startsWith('﻿'));
  assert.ok(!text.includes('\r'));
  assert.ok(text.startsWith('---\nname: fix-me\n'));
});

test('rule severity overrides and "off"', () => {
  const r = lintFixture('person', { rules: { 'description-person': 'error' } });
  assert.equal(r.findings[0].severity, 'error');
  assert.deepEqual(lintFixture('person', { rules: { 'description-person': 'off' } }).findings, []);
});

test('a SKILL.md passed as a file path is linted', () => {
  const r = lint({ cwd: FIXTURES, paths: ['person/first-person/SKILL.md'] });
  assert.equal(r.stats.skills, 1);
  assert.deepEqual(idsOf(r), ['description-person']);
});
