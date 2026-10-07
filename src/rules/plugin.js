// Rules for Claude Code plugin manifests:
//   .claude-plugin/plugin.json       https://code.claude.com/docs/en/plugins-reference
//   .claude-plugin/marketplace.json  https://code.claude.com/docs/en/plugins/marketplace-reference
import fs from 'node:fs';
import path from 'node:path';
import { exists, isDir, isFile } from '../fsutil.js';

const PLUGIN_FIELDS = new Set([
  '$schema', 'name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'metadata',
  'icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl', 'defaultEnabled', 'dependencies', 'settings',
  'userConfig', 'types', 'channels', 'skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'workflows', 'experimental',
]);
const DIRECTORY_LISTING_FIELDS = new Set(['icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']);
const DEPRECATED_TOP_LEVEL = { themes: 'experimental.themes', monitors: 'experimental.monitors' };
const MARKETPLACE_FIELDS = new Set(['$schema', 'name', 'owner', 'plugins', 'description', 'version', 'metadata', 'forceRemoveDeletedPlugins', 'allowCrossMarketplaceDependenciesOn', 'renames']);
const MARKETPLACE_METADATA_FIELDS = new Set(['description', 'version', 'pluginRoot']);
const ENTRY_FIELDS = new Set(['name', 'source', 'description', 'version', 'category', 'tags', 'strict', 'relevance', 'dependencies', 'defaultEnabled', 'displayName', 'metadata', 'headers', 'headersHelper']);
const SOURCE_TYPES = ['github', 'url', 'git-subdir', 'npm', 'archive', 'command'];
const COMPONENT_DIRS = new Set(['skills', 'commands', 'agents', 'hooks', 'output-styles', 'workflows', 'themes', 'monitors', 'bin']);
const COMPONENT_FILES = new Set(['.mcp.json', '.lsp.json', 'settings.json']);

const OFFICIAL_MARKETPLACES = [
  'claude-code-marketplace', 'claude-code-plugins', 'claude-plugins-official', 'anthropic-marketplace', 'anthropic-plugins', 'agent-skills',
  'anthropic-agent-skills', 'life-sciences', 'knowledge-work-plugins', 'claude-for-legal', 'claude-for-financial-services',
  'financial-services-plugins', 'first-party-plugins', 'claude-tag-plugins', 'claude-community', 'claude-plugins-community', 'healthcare',
  'anthropic-plugin-directory', 'claude-plugin-directory',
];
const INTERNAL_MARKETPLACES = ['inline', 'builtin', 'skills-dir', 'synced', 'claude-plugin-test'];
const PACKAGE_MANAGER_NAMES = ['npm', 'pip', 'uv', 'cargo', 'github', 'gh'];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/;

/** Parse JSON and turn syntax errors into a line/column. */
function parseJson(text) {
  const clean = text.replace(/^﻿/, '');
  try {
    return { value: JSON.parse(clean) };
  } catch (err) {
    let line = 1;
    let column = 1;
    const lc = /line (\d+) column (\d+)/.exec(err.message);
    const pos = /position (\d+)/.exec(err.message);
    if (lc) {
      line = Number(lc[1]);
      column = Number(lc[2]);
    } else if (pos) {
      const before = clean.slice(0, Number(pos[1]));
      line = before.split('\n').length;
      column = Number(pos[1]) - before.lastIndexOf('\n');
    }
    return { error: err.message.replace(/^JSON\.parse: /, ''), line, column };
  }
}

/** Best-effort line number of `"key":` in JSON text (the first occurrence after `after`). */
function keyLine(text, key, after = 0) {
  const re = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`, 'g');
  re.lastIndex = after;
  const m = re.exec(text);
  if (!m) return { line: 1, column: 1, index: after };
  const before = text.slice(0, m.index);
  return { line: before.split('\n').length, column: m.index - before.lastIndexOf('\n'), index: m.index };
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function reservedPluginName(name) {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const words = n.split('-');
  if (/^(claude|anthropic|anthropics|cc-plugin)-/.test(n)) return 'error';
  if (['claude', 'anthropic', 'anthropics', 'claude-code', 'claude-mods'].includes(n)) return 'error';
  if (words.includes('official') && (words.includes('claude') || words.includes('anthropic') || words.includes('anthropics'))) return 'error';
  if (words.includes('claude') || words.includes('anthropic') || words.includes('anthropics')) return 'warning';
  return null;
}

function checkRelativePath(p, { allowDot = false, allowUrl = false } = {}) {
  if (typeof p !== 'string' || p === '') return 'must be a non-empty string';
  if (allowUrl && /^https:\/\//i.test(p)) return null;
  if (allowDot && (p === '.' || p === './')) return null;
  if (!p.startsWith('./')) return `must start with "./" (got "${p}")`;
  if (p.split(/[\\/]/).includes('..')) return `contains ".." (path traversal) ("${p}")`;
  return null;
}

// ------------------------------------------------------------------ plugin.json

export function lintPluginManifest(file, ctx) {
  const root = path.dirname(path.dirname(file));
  const R = (id, f) => ctx.report(id, { file, ...f });
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseJson(text);
  if (parsed.error) {
    R('plugin-json-invalid', { line: parsed.line, column: parsed.column, message: `plugin.json is not valid JSON: ${parsed.error}.`, hint: 'Claude Code cannot load the plugin. Check for trailing commas and unquoted keys.' });
    return null;
  }
  const m = parsed.value;
  if (!isObj(m)) {
    R('plugin-json-invalid', { line: 1, message: 'plugin.json must contain a JSON object.', hint: '{ "name": "my-plugin" }' });
    return null;
  }
  const at = (key) => keyLine(text, key);

  // name
  if (typeof m.name !== 'string' || m.name.trim() === '') {
    R('plugin-name', { line: m.name === undefined ? 1 : at('name').line, message: '`name` is required and must be a non-empty string.', hint: `"name": "${path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-')}"` });
  } else {
    const n = m.name;
    if (/[\s@:/\\]/.test(n) || CONTROL_RE.test(n)) {
      R('plugin-name', { ...at('name'), message: `Plugin name "${n}" contains spaces, "@", ":", path separators or control characters.`, hint: 'Use kebab-case, e.g. "deploy-tools".' });
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) {
      R('plugin-name-style', { ...at('name'), message: `Plugin name "${n}" is not kebab-case; \`claude plugin validate\` warns about it.`, hint: `"name": "${n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}"` });
    }
    const reserved = reservedPluginName(n);
    if (reserved === 'error') {
      R('plugin-name-reserved', { ...at('name'), message: `Plugin name "${n}" is reserved: it passes as one of Anthropic's own plugins.`, hint: 'Choose a name that does not start with claude-/anthropic- and does not pair "official" with claude/anthropic.' });
    } else if (reserved === 'warning') {
      R('plugin-name-style', { ...at('name'), message: `Plugin name "${n}" reads as one of Anthropic's own (contains "claude" or "anthropic" as a word).`, hint: 'Prefer a name that describes what the plugin does.' });
    }
  }

  // unknown / deprecated fields
  for (const key of Object.keys(m)) {
    if (DEPRECATED_TOP_LEVEL[key]) {
      R('plugin-unknown-field', { ...at(key), message: `Top-level \`${key}\` is deprecated; move it to \`${DEPRECATED_TOP_LEVEL[key]}\`.`, hint: `"experimental": { "${key}": ... }` });
    } else if (!PLUGIN_FIELDS.has(key)) {
      R('plugin-unknown-field', { ...at(key), message: `Unknown plugin.json field \`${key}\`; Claude Code strips it at load time.`, hint: 'Put custom data under "metadata".' });
    }
  }

  // types
  const strField = (key) => {
    if (m[key] !== undefined && typeof m[key] !== 'string') R('plugin-field-type', { ...at(key), message: `\`${key}\` must be a string.`, hint: `"${key}": "..."` });
  };
  ['displayName', 'version', 'description', 'repository', 'license', 'types'].forEach(strField);
  if (m.author !== undefined) {
    if (!isObj(m.author)) R('plugin-field-type', { ...at('author'), message: '`author` must be an object such as {"name": "Your Name"}, not a string.', hint: '"author": { "name": "Your Name", "url": "https://github.com/you" }' });
    else if (typeof m.author.name !== 'string' || !m.author.name.trim()) R('plugin-field-type', { ...at('author'), message: '`author.name` is required.', hint: '"author": { "name": "Your Name" }' });
  }
  if (m.homepage !== undefined) {
    let ok = typeof m.homepage === 'string';
    if (ok) {
      try {
        new URL(m.homepage);
      } catch {
        ok = false;
      }
    }
    if (!ok) R('plugin-field-type', { ...at('homepage'), message: '`homepage` must be a valid URL; otherwise the plugin fails to load.', hint: '"homepage": "https://github.com/you/plugin"' });
  }
  for (const key of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
    if (m[key] !== undefined && !(typeof m[key] === 'string' && /^https:\/\//.test(m[key]))) R('plugin-field-type', { ...at(key), message: `\`${key}\` must be an https:// URL.`, hint: `"${key}": "https://..."` });
  }
  if (m.keywords !== undefined && !(Array.isArray(m.keywords) && m.keywords.every((k) => typeof k === 'string'))) {
    R('plugin-field-type', { ...at('keywords'), message: '`keywords` must be an array of strings.', hint: '"keywords": ["deployment", "ci"]' });
  }
  if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== 'boolean') R('plugin-field-type', { ...at('defaultEnabled'), message: '`defaultEnabled` must be true or false.', hint: '"defaultEnabled": true' });
  for (const key of ['metadata', 'settings', 'userConfig', 'experimental']) {
    if (m[key] !== undefined && !isObj(m[key])) R('plugin-field-type', { ...at(key), message: `\`${key}\` must be an object.`, hint: `"${key}": { }` });
  }
  if (m.dependencies !== undefined && !Array.isArray(m.dependencies)) R('plugin-field-type', { ...at('dependencies'), message: '`dependencies` must be an array.', hint: '"dependencies": ["other-plugin"]' });
  if (m.channels !== undefined && !Array.isArray(m.channels)) R('plugin-field-type', { ...at('channels'), message: '`channels` must be an array.', hint: '"channels": []' });

  // recommended
  const missing = ['version', 'description', 'author'].filter((k) => m[k] === undefined);
  if (missing.length) {
    R('plugin-recommended-fields', { line: 1, message: `plugin.json has no ${missing.map((k) => `\`${k}\``).join(', ')}; \`claude plugin validate\` warns and users see less in /plugin.`, hint: missing.map((k) => (k === 'author' ? '"author": { "name": "..." }' : `"${k}": "..."`)).join(', ') });
  }

  // component paths
  const checkPath = (key, p, opts = {}) => {
    const loc = at(key);
    const problem = checkRelativePath(p, opts);
    if (problem) {
      R('plugin-path', { ...loc, message: `\`${key}\` path ${problem}.`, hint: 'Component paths are relative to the plugin root and start with "./", e.g. "./commands/deploy.md".' });
      return;
    }
    if (/^https:\/\//i.test(p)) return;
    const abs = path.resolve(root, p);
    if (!exists(abs)) {
      R('plugin-path', { ...loc, message: `\`${key}\` path "${p}" does not exist ("Path not found").`, hint: 'Fix the path or create the file/directory.' });
      return;
    }
    if (opts.dirOnly && !isDir(abs)) R('plugin-path', { ...loc, message: `\`${key}\` entries must be directories ("${p}" is a file).`, hint: 'Point to a directory of <name>/SKILL.md folders, or to one skill folder.' });
    if (opts.ext && isFile(abs) && !opts.ext.some((e) => p.toLowerCase().endsWith(e))) R('plugin-path', { ...loc, message: `\`${key}\` entry "${p}" must be a ${opts.ext.join(' or ')} file.`, hint: `Use a ${opts.ext.join('/')} file.` });
  };
  const forEachPath = (key, value, opts) => {
    if (value === undefined) return;
    const list = Array.isArray(value) ? value : [value];
    for (const v of list) {
      if (typeof v === 'string') checkPath(key, v, opts);
      else if (!opts.inline || !isObj(v)) R('plugin-field-type', { ...at(key), message: `\`${key}\` entries must be path strings${opts.inline ? ' or inline objects' : ''}.`, hint: `"${key}": "./..."` });
    }
  };
  forEachPath('skills', m.skills, { allowDot: true, dirOnly: true });
  forEachPath('agents', m.agents, { ext: ['.md'] });
  forEachPath('outputStyles', m.outputStyles, {});
  forEachPath('workflows', m.workflows, {});
  forEachPath('hooks', m.hooks, { inline: true, ext: ['.json'] });
  forEachPath('mcpServers', m.mcpServers, { inline: true, allowUrl: true, ext: ['.json', '.mcpb', '.dxt'] });
  forEachPath('lspServers', m.lspServers, { inline: true, ext: ['.json'] });
  if (isObj(m.experimental)) {
    forEachPath('themes', m.experimental.themes, {});
    if (typeof m.experimental.monitors === 'string') checkPath('monitors', m.experimental.monitors, { ext: ['.json'] });
  }
  if (m.commands !== undefined) {
    if (isObj(m.commands)) {
      for (const [name, entry] of Object.entries(m.commands)) {
        if (!isObj(entry) || (entry.source === undefined) === (entry.content === undefined)) {
          R('plugin-field-type', { ...keyLine(text, name), message: `Command "${name}" must set exactly one of \`source\` or \`content\`.`, hint: `"${name}": { "source": "./commands/${name}.md" }` });
        } else if (entry.source !== undefined) {
          checkPath('commands', entry.source, { ext: ['.md'] });
        }
      }
    } else {
      forEachPath('commands', m.commands, {});
    }
  }

  // misplaced components
  const pluginDir = path.dirname(file);
  let entries = [];
  try {
    entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  } catch {
    /* ignore */
  }
  for (const e of entries) {
    if ((e.isDirectory() && COMPONENT_DIRS.has(e.name)) || (e.isFile() && COMPONENT_FILES.has(e.name))) {
      R('plugin-misplaced-component', {
        line: 1,
        message: `.claude-plugin/${e.name} is inside .claude-plugin/; Claude Code only reads plugin.json there, so it is never loaded.`,
        hint: `Move it to the plugin root: ${e.name}`,
      });
    }
  }
  return { name: typeof m.name === 'string' ? m.name : null, version: typeof m.version === 'string' ? m.version : null };
}

// ------------------------------------------------------------------ marketplace.json

function marketplaceNameProblem(name) {
  if (!ID_RE.test(name) || name.includes('..')) return 'may only use letters, digits, ".", "_" and "-", must start with a letter or digit, and must not contain ".."';
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(name)) return 'contains a non-ASCII character, which Claude Code treats as impersonating an official marketplace';
  const lower = name.toLowerCase();
  if (lower.startsWith('claudeai-')) return 'starts with "claudeai-", which is reserved for marketplaces hosted on claude.ai';
  if (PACKAGE_MANAGER_NAMES.includes(lower)) return 'is reserved';
  if (INTERNAL_MARKETPLACES.includes(lower)) return 'is reserved for plugins that do not come from a marketplace';
  const spelled = lower.replace(/\.+$/, '').replace(/[^a-z0-9_]+/g, '-');
  if (OFFICIAL_MARKETPLACES.includes(spelled)) return 'is reserved for official Anthropic marketplaces';
  const words = spelled.split(/[-_]+/);
  if (words.includes('official') && (words.includes('claude') || words.includes('anthropic'))) return 'impersonates an official Anthropic/Claude marketplace';
  if (/^claude-plugins-/.test(spelled) || /^anthropic-plugins-/.test(spelled)) return 'impersonates an official Anthropic/Claude marketplace';
  return null;
}

export function lintMarketplace(file, ctx) {
  const root = path.dirname(path.dirname(file));
  const R = (id, f) => ctx.report(id, { file, ...f });
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseJson(text);
  if (parsed.error) {
    R('marketplace-json-invalid', { line: parsed.line, column: parsed.column, message: `marketplace.json is not valid JSON: ${parsed.error}.`, hint: 'Check for trailing commas and unquoted keys.' });
    return;
  }
  const m = parsed.value;
  if (!isObj(m)) {
    R('marketplace-json-invalid', { line: 1, message: 'marketplace.json must contain a JSON object.', hint: '{ "name": "...", "owner": { "name": "..." }, "plugins": [] }' });
    return;
  }
  const at = (key, after) => keyLine(text, key, after);

  // required
  if (typeof m.name !== 'string' || !m.name.trim()) {
    R('marketplace-required-fields', { line: 1, message: 'Marketplace must have a `name`.', hint: '"name": "my-marketplace"' });
  } else {
    const problem = marketplaceNameProblem(m.name);
    if (problem) R('marketplace-name', { ...at('name'), message: `Marketplace name "${m.name}" ${problem}.`, hint: 'Use a unique kebab-case name, e.g. "acme-tools".' });
  }
  if (!isObj(m.owner)) {
    R('marketplace-required-fields', { line: m.owner === undefined ? 1 : at('owner').line, message: '`owner` must be an object with a `name`.', hint: '"owner": { "name": "Your Name" }' });
  } else if (typeof m.owner.name !== 'string' || !m.owner.name.trim()) {
    R('marketplace-required-fields', { ...at('owner'), message: '`owner.name` cannot be empty.', hint: '"owner": { "name": "Your Name" }' });
  }
  if (!Array.isArray(m.plugins)) {
    R('marketplace-required-fields', { line: m.plugins === undefined ? 1 : at('plugins').line, message: '`plugins` must be an array of plugin entries.', hint: '"plugins": [ { "name": "my-plugin", "source": "./plugins/my-plugin" } ]' });
  } else if (m.plugins.length === 0) {
    R('marketplace-recommended-fields', { ...at('plugins'), message: 'Marketplace has no plugins defined.', hint: 'Add at least one plugin entry.' });
  }

  // recommended + unknown
  const description = m.description ?? (isObj(m.metadata) ? m.metadata.description : undefined);
  if (!description) {
    R('marketplace-recommended-fields', { line: 1, message: 'No marketplace description; users see it when they add the marketplace.', hint: '"description": "What these plugins are for"' });
  }
  for (const key of Object.keys(m)) {
    if (!MARKETPLACE_FIELDS.has(key)) R('marketplace-unknown-field', { ...at(key), message: `Unknown field \`${key}\`; Claude Code ignores it at load time.`, hint: 'Remove it or move it under "metadata".' });
  }
  if (isObj(m.metadata)) {
    for (const key of Object.keys(m.metadata)) {
      if (!MARKETPLACE_METADATA_FIELDS.has(key)) R('marketplace-unknown-field', { ...at(key), message: `Unknown field \`metadata.${key}\`; Claude Code ignores it.`, hint: 'metadata supports description, version and pluginRoot.' });
    }
  }
  const pluginRoot = isObj(m.metadata) && typeof m.metadata.pluginRoot === 'string' ? m.metadata.pluginRoot : null;
  if (pluginRoot) {
    const problem = checkRelativePath(pluginRoot.startsWith('./') ? pluginRoot : `./${pluginRoot}`);
    if (problem) R('marketplace-source', { ...at('pluginRoot'), message: `\`metadata.pluginRoot\` ${problem}.`, hint: '"pluginRoot": "./plugins"' });
  }

  if (!Array.isArray(m.plugins)) return;
  const seen = new Map();
  let cursor = at('plugins').index || 0;
  m.plugins.forEach((entry, i) => {
    const loc = at('name', cursor);
    cursor = loc.index + 1;
    const label = `plugins[${i}]`;
    if (!isObj(entry)) {
      R('marketplace-plugin-entry', { line: loc.line, message: `${label} must be an object.`, hint: '{ "name": "my-plugin", "source": "./plugins/my-plugin" }' });
      return;
    }
    const where = { line: loc.line, column: loc.column };
    if (typeof entry.name !== 'string' || !entry.name) {
      R('marketplace-plugin-entry', { ...where, message: `${label} has no \`name\`.`, hint: '"name": "my-plugin"' });
    } else {
      if (!ID_RE.test(entry.name) || CONTROL_RE.test(entry.name)) {
        R('marketplace-plugin-entry', { ...where, message: `Plugin name "${entry.name}" cannot be installed: use only letters, digits, ".", "_" and "-", starting with a letter or digit.`, hint: 'Use kebab-case.' });
      }
      if (reservedPluginName(entry.name) === 'error') {
        R('marketplace-plugin-entry', { ...where, message: `Plugin name "${entry.name}" is reserved: it passes as one of Anthropic's own.`, hint: 'Choose another name.' });
      }
      if (seen.has(entry.name)) R('marketplace-plugin-entry', { ...where, message: `Duplicate plugin name "${entry.name}" in marketplace.`, hint: 'Each entry needs a unique name.' });
      seen.set(entry.name, i);
    }
    for (const key of Object.keys(entry)) {
      if (DIRECTORY_LISTING_FIELDS.has(key) || (!ENTRY_FIELDS.has(key) && !PLUGIN_FIELDS.has(key))) {
        R('marketplace-unknown-field', { ...where, message: `Unknown field \`${key}\` in ${label}; Claude Code ignores it.`, hint: DIRECTORY_LISTING_FIELDS.has(key) ? `Set ${key} in the plugin's own plugin.json instead.` : 'Remove it.' });
      }
    }
    // source
    const src = entry.source;
    if (src === undefined) {
      R('marketplace-plugin-entry', { ...where, message: `${label} has no \`source\`.`, hint: '"source": "./plugins/my-plugin"' });
      return;
    }
    if (typeof src === 'string') {
      let rel = src;
      if (src !== '.' && !src.startsWith('./')) {
        if (pluginRoot && !src.includes('/')) rel = `${pluginRoot.replace(/\/$/, '')}/${src}`;
        else {
          R('marketplace-source', { ...where, message: `${label}.source "${src}" must start with "./" (relative to the marketplace root)${src.includes('/') ? '' : ' or be a bare name with metadata.pluginRoot set'}.`, hint: `"source": "./${src.replace(/^\/+/, '')}"` });
          return;
        }
      }
      if (rel.split(/[\\/]/).includes('..')) {
        R('marketplace-source', { ...where, message: `${label}.source "${src}" contains "..", which \`claude plugin validate\` rejects.`, hint: 'Keep plugins inside the marketplace directory.' });
        return;
      }
      if (rel.slice(2).includes('\\')) {
        R('marketplace-source', { ...where, message: `${label}.source "${src}" contains a backslash; Claude Code refuses it on macOS and Linux.`, hint: `Use forward slashes: "${src.replace(/\\/g, '/')}"` });
        return;
      }
      const abs = path.resolve(root, rel);
      if (!isDir(abs)) {
        R('marketplace-source', { ...where, message: `${label}.source "${src}" does not exist; \`claude plugin install\` fails with "Source path does not exist".`, hint: 'Paths resolve from the directory that contains .claude-plugin/, not from .claude-plugin/ itself.' });
        return;
      }
      const manifest = path.join(abs, '.claude-plugin', 'plugin.json');
      if (isFile(manifest)) {
        const pj = parseJson(fs.readFileSync(manifest, 'utf8'));
        if (pj.value && isObj(pj.value)) {
          if (typeof entry.name === 'string' && typeof pj.value.name === 'string' && entry.name !== pj.value.name) {
            R('marketplace-consistency', { ...where, message: `Entry name "${entry.name}" differs from the plugin's plugin.json name "${pj.value.name}"; installing by the manifest name fails with "not found in marketplace".`, hint: 'Use the same name in both files.' });
          }
          if (typeof entry.version === 'string' && typeof pj.value.version === 'string' && entry.version !== pj.value.version) {
            R('marketplace-consistency', { ...where, message: `Entry version "${entry.version}" differs from plugin.json version "${pj.value.version}"; plugin.json wins at install time.`, hint: 'Set the version in plugin.json only.' });
          }
        }
      }
      return;
    }
    if (!isObj(src) || !SOURCE_TYPES.includes(src.source)) {
      R('marketplace-source', { ...where, message: `${label}.source ${isObj(src) ? `has unknown type "${src.source}"` : 'must be a "./path" string or a source object'}; valid types: ${SOURCE_TYPES.join(', ')}.`, hint: '{ "source": "github", "repo": "owner/repo" }' });
      return;
    }
    const need = (cond, msg, hint) => {
      if (!cond) R('marketplace-source', { ...where, message: `${label}.source: ${msg}.`, hint });
    };
    if (src.source === 'github') need(typeof src.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(src.repo), '`repo` must be "owner/repo"', '"repo": "owner/repo"');
    if (src.source === 'url') need(typeof src.url === 'string' && /^(https?:\/\/|file:\/\/|git@)/.test(src.url), '`url` must be a full git URL (https://, http://, file:// or git@)', '"url": "https://gitlab.com/org/repo.git"');
    if (src.source === 'git-subdir') {
      need(typeof src.url === 'string' && src.url.length > 0, '`url` is required', '"url": "owner/monorepo"');
      need(typeof src.path === 'string' && src.path.length > 0, '`path` is required', '"path": "tools/my-plugin"');
    }
    if (src.source === 'npm') need(typeof src.package === 'string' && src.package && !src.package.includes('..'), '`package` must be an npm package name', '"package": "@org/plugin"');
    if (src.source === 'archive') {
      need(typeof src.url === 'string' && /^https:\/\//.test(src.url), '`url` must use https://', '"url": "https://example.com/plugin.zip"');
      if (src.sha256 !== undefined) need(typeof src.sha256 === 'string' && /^[0-9a-fA-F]{64}$/.test(src.sha256), '`sha256` must be 64 hex characters', '"sha256": "..."');
    }
    if (src.source === 'command') {
      need(typeof src.command === 'string' && src.command.length > 0 && src.command.length <= 500 && /^[\x20-\x7e]+$/.test(src.command) && !/ {4}/.test(src.command), '`command` must be printable ASCII, at most 500 characters, without runs of 4+ spaces', '"command": "my-tool claude-plugin-path"');
      if (src.timeout !== undefined) need(Number.isInteger(src.timeout) && src.timeout >= 1 && src.timeout <= 600, '`timeout` must be a whole number of seconds from 1 to 600', '"timeout": 60');
    }
    if (src.sha !== undefined) need(typeof src.sha === 'string' && /^[0-9a-f]{40}$/.test(src.sha), '`sha` must be a full 40-character lowercase commit SHA', '"sha": "<40 hex chars>"');
  });
}
