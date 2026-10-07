import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../src/yaml.js';
import { splitFrontmatter } from '../src/frontmatter.js';

const ok = (src) => {
  const r = parseYaml(src);
  assert.equal(r.error, null, r.error && r.error.message);
  return r;
};

test('parses the spec example with nested metadata', () => {
  const r = ok('name: pdf-processing\ndescription: Extract PDF text. Use when handling PDFs.\nlicense: Apache-2.0\nmetadata:\n  author: example-org\n  version: "1.0"\nallowed-tools: Bash(git:*) Read');
  assert.deepEqual(r.value, {
    name: 'pdf-processing',
    description: 'Extract PDF text. Use when handling PDFs.',
    license: 'Apache-2.0',
    metadata: { author: 'example-org', version: '1.0' },
    'allowed-tools': 'Bash(git:*) Read',
  });
  assert.deepEqual(r.locations.get('metadata.version'), { line: 6, column: 3 });
});

test('scalars: null, booleans, numbers, strings', () => {
  const r = ok('a: ~\nb: true\nc: False\nd: 42\ne: 1.0\nf: 0x1f\ng: hello world\nh:\ni: "007"');
  assert.deepEqual(r.value, { a: null, b: true, c: false, d: 42, e: 1, f: 31, g: 'hello world', h: null, i: '007' });
});

test('block scalars: literal, folded and chomping', () => {
  const r = ok('lit: |\n  line one\n    indented\n  line three\nfold: >\n  folded one\n  folded two\n\n  para\nstrip: |-\n  x\nkeep: |+\n  y\n\nlast: z');
  assert.equal(r.value.lit, 'line one\n  indented\nline three\n');
  assert.equal(r.value.fold, 'folded one folded two\npara\n');
  assert.equal(r.value.strip, 'x');
  assert.equal(r.value.keep, 'y\n\n');
  assert.equal(r.value.last, 'z');
});

test('multi-line plain and quoted scalars fold into one line', () => {
  const r = ok("plain: first part\n  second part\nsingle: 'it''s\n  folded'\ndouble: \"tab\\there \\u00e9\n  next\"");
  assert.equal(r.value.plain, 'first part second part');
  assert.equal(r.value.single, "it's folded");
  assert.equal(r.value.double, 'tab\there é next');
});

test('sequences, compact mappings and flow collections', () => {
  const r = ok('tools:\n  - Read\n  - Grep\nsame:\n- a\n- b\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\nflow: [a, "b, c", 3]\nmap: {x: 1, y: two}\nempty: []');
  assert.deepEqual(r.value.tools, ['Read', 'Grep']);
  assert.deepEqual(r.value.same, ['a', 'b']);
  assert.deepEqual(r.value.hooks, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command' }] }] });
  assert.deepEqual(r.value.flow, ['a', 'b, c', 3]);
  assert.deepEqual(r.value.map, { x: 1, y: 'two' });
  assert.deepEqual(r.value.empty, []);
});

test('comments are ignored, URLs with colons are fine', () => {
  const r = ok('# comment\nhome: https://example.com/a:b # trailing\nk: v');
  assert.deepEqual(r.value, { home: 'https://example.com/a:b', k: 'v' });
});

test('rejects ": " inside a plain value like PyYAML and js-yaml do', () => {
  const r = parseYaml('description: Use when: the user asks', { lineOffset: 1 });
  assert.ok(r.error);
  assert.match(r.error.message, /mapping values are not allowed/);
  assert.equal(r.error.line, 2);
  assert.equal(r.error.column, 22);
});

test('rejects a value ending with ":"', () => {
  assert.ok(parseYaml('description: Do this:').error);
});

test('rejects duplicate keys, tabs, bad indentation and unterminated strings', () => {
  assert.match(parseYaml('a: 1\na: 2').error.message, /duplicate key/);
  assert.match(parseYaml('\ta: 1').error.message, /tabs/);
  assert.match(parseYaml('a: 1\n  b: 2').error.message, /indentation|mapping values/);
  assert.match(parseYaml('a: "open').error.message, /unterminated/);
  assert.match(parseYaml('a: [1, 2').error.message, /unterminated/);
  assert.match(parseYaml('a: @x').error.message, /cannot start/);
  assert.match(parseYaml('a: "bad \\q"').error.message, /unknown escape/);
  assert.equal(parseYaml('just text').value, 'just text');
});

test('warns about " #" truncation, YAML 1.1 booleans and anchors', () => {
  const r = ok('a: see issue #12 for details\nb: yes\nc: &anchor value');
  assert.equal(r.value.a, 'see issue');
  assert.equal(r.value.b, 'yes');
  assert.equal(r.value.c, 'value');
  assert.equal(r.warnings.length, 3);
  assert.match(r.warnings[0].message, /comment/);
  assert.match(r.warnings[1].message, /YAML 1\.1/);
  assert.match(r.warnings[2].message, /anchors/);
});

test('quoted keys and empty documents', () => {
  assert.deepEqual(ok('"quoted key": 1\n\'single\': 2').value, { 'quoted key': 1, single: 2 });
  assert.equal(ok('').value, null);
  assert.equal(ok('# only a comment').value, null);
});

test('splitFrontmatter finds delimiters, BOM, CRLF and late frontmatter', () => {
  const a = splitFrontmatter('---\nname: x\n---\nbody\n');
  assert.equal(a.hasFrontmatter, true);
  assert.equal(a.raw, 'name: x');
  assert.equal(a.bodyStartLine, 4);
  assert.equal(a.body, 'body\n');

  const b = splitFrontmatter('\ufeff---\r\nname: x\r\n---\r\n');
  assert.equal(b.bom, true);
  assert.equal(b.crlf, true);
  assert.equal(b.raw, 'name: x');

  const c = splitFrontmatter('# Title\n\n---\nname: x\n---\n');
  assert.equal(c.hasFrontmatter, false);
  assert.equal(c.lateDelimiterLine, 3);

  const d = splitFrontmatter('---\nname: x\n');
  assert.equal(d.unterminated, true);

  const e = splitFrontmatter('---  \nname: x\n--- \n');
  assert.equal(e.openDelimiter, '---  ');
  assert.equal(e.closeDelimiter, '--- ');
});
