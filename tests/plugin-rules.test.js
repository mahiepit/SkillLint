import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint } from '../src/linter.js';
import { lintFixture, uniq, tempDir, write } from './_helpers.js';

const ids = (r) => r.findings.map((f) => f.ruleId).sort();

test('a valid plugin + marketplace has no findings', () => {
  const r = lintFixture('plugin-valid');
  assert.deepEqual(r.findings, []);
  assert.equal(r.stats.plugins, 1);
  assert.equal(r.stats.marketplaces, 1);
  assert.equal(r.stats.skills, 1);
});

test('invalid plugin.json: name, types, paths, unknown fields, misplaced components', () => {
  const r = lintFixture('plugin-invalid');
  const plugin = r.findings.filter((f) => f.file.endsWith('plugin.json'));
  assert.deepEqual(uniq(plugin.map((f) => f.ruleId)), [
    'plugin-field-type',
    'plugin-misplaced-component',
    'plugin-name',
    'plugin-path',
    'plugin-recommended-fields',
    'plugin-unknown-field',
  ]);
  const paths = plugin.filter((f) => f.ruleId === 'plugin-path').map((f) => f.message);
  assert.equal(paths.length, 3);
  assert.ok(paths.some((m) => /must start with "\.\/"/.test(m)));
  assert.ok(paths.some((m) => /does not exist/.test(m)));
  assert.ok(paths.some((m) => /\.\./.test(m)));
  assert.equal(plugin.filter((f) => f.ruleId === 'plugin-field-type').length, 3);
});

test('invalid marketplace.json: reserved name, owner, sources, duplicates, unknown fields', () => {
  const r = lintFixture('plugin-invalid');
  const market = r.findings.filter((f) => f.file.endsWith('marketplace.json'));
  assert.deepEqual(uniq(market.map((f) => f.ruleId)), [
    'marketplace-name',
    'marketplace-plugin-entry',
    'marketplace-recommended-fields',
    'marketplace-required-fields',
    'marketplace-source',
    'marketplace-unknown-field',
  ]);
  const sources = market.filter((f) => f.ruleId === 'marketplace-source');
  assert.equal(sources.length, 5);
  assert.ok(market.some((f) => /Duplicate plugin name "a"/.test(f.message)));
  assert.ok(market.some((f) => f.ruleId === 'marketplace-name' && /reserved/.test(f.message)));
});

test('broken JSON reports a line number', () => {
  const r = lintFixture('plugin-broken-json');
  assert.deepEqual(ids(r), ['plugin-json-invalid']);
  assert.equal(r.findings[0].line, 3);
});

test('reserved plugin names', () => {
  assert.deepEqual(ids(lintFixture('plugin-reserved')), ['plugin-name-reserved']);
  const dir = tempDir();
  write(dir, '.claude-plugin/plugin.json', JSON.stringify({ name: 'tools-for-claude', version: '1', description: 'x', author: { name: 'x' } }));
  assert.deepEqual(ids(lint({ cwd: dir })), ['plugin-name-style']);
});

test('plugin rules only apply when Claude Code is targeted', () => {
  assert.deepEqual(lintFixture('plugin-invalid', { targets: ['codex', 'cursor'] }).findings, []);
});

test('marketplace consistency with the plugin\'s own plugin.json', () => {
  const dir = tempDir();
  write(dir, '.claude-plugin/marketplace.json', JSON.stringify({
    name: 'acme',
    description: 'Acme plugins',
    owner: { name: 'Acme' },
    plugins: [{ name: 'formatter', source: './plugins/fmt', version: '2.0.0' }],
  }, null, 2));
  write(dir, 'plugins/fmt/.claude-plugin/plugin.json', JSON.stringify({ name: 'fmt', version: '1.0.0', description: 'x', author: { name: 'x' } }, null, 2));
  const r = lint({ cwd: dir });
  const c = r.findings.filter((f) => f.ruleId === 'marketplace-consistency');
  assert.equal(c.length, 2);
});

test('metadata.pluginRoot allows bare source names', () => {
  const dir = tempDir();
  write(dir, '.claude-plugin/marketplace.json', JSON.stringify({
    name: 'acme',
    description: 'Acme plugins',
    owner: { name: 'Acme' },
    metadata: { pluginRoot: './plugins' },
    plugins: [{ name: 'fmt', source: 'fmt' }, { name: 'gone', source: 'gone' }],
  }, null, 2));
  write(dir, 'plugins/fmt/README.md', '# fmt\n');
  const r = lint({ cwd: dir });
  assert.deepEqual(ids(r), ['marketplace-source']);
  assert.match(r.findings[0].message, /gone/);
});

test('remote source objects are validated', () => {
  const dir = tempDir();
  write(dir, '.claude-plugin/marketplace.json', JSON.stringify({
    name: 'acme',
    description: 'Acme plugins',
    owner: { name: 'Acme' },
    plugins: [
      { name: 'ok-gh', source: { source: 'github', repo: 'acme/ok', ref: 'v1' } },
      { name: 'ok-url', source: { source: 'url', url: 'https://gitlab.com/acme/x.git' } },
      { name: 'ok-npm', source: { source: 'npm', package: '@acme/x' } },
      { name: 'bad-sha', source: { source: 'github', repo: 'acme/x', sha: 'abc' } },
      { name: 'bad-archive', source: { source: 'archive', url: 'http://insecure/x.zip' } },
      { name: 'bad-subdir', source: { source: 'git-subdir', url: 'acme/mono' } },
    ],
  }, null, 2));
  const r = lint({ cwd: dir });
  assert.deepEqual(ids(r), ['marketplace-source', 'marketplace-source', 'marketplace-source']);
});
