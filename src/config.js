// Optional config file: .skilllintrc.json or skilllint.config.json
//
// {
//   "targets": ["claude", "codex"],
//   "rules": { "unreferenced-file": "off", "name-vague": "error" },
//   "ignore": ["tests/fixtures/**"]
// }
import fs from 'node:fs';
import path from 'node:path';
import { RULE_MAP } from './rules/registry.js';

export const CONFIG_FILES = ['.skilllintrc.json', 'skilllint.config.json'];
const LEVELS = ['off', 'info', 'warning', 'error'];

export function findConfig(cwd) {
  for (const name of CONFIG_FILES) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function loadConfig(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`Cannot read config ${file}: ${err.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Config ${file} must be a JSON object`);
  const known = ['$schema', 'targets', 'rules', 'ignore'];
  for (const k of Object.keys(raw)) {
    if (!known.includes(k)) throw new Error(`Config ${file}: unknown key "${k}" (expected ${known.join(', ')})`);
  }
  return {
    targets: raw.targets,
    rules: validateRules(raw.rules || {}, file),
    ignore: Array.isArray(raw.ignore) ? raw.ignore : raw.ignore ? [raw.ignore] : [],
    dir: path.dirname(file),
  };
}

export function validateRules(rules, where) {
  const out = {};
  for (const [id, level] of Object.entries(rules)) {
    if (!RULE_MAP.has(id)) throw new Error(`${where}: unknown rule "${id}"`);
    const l = level === 'warn' ? 'warning' : level;
    if (!LEVELS.includes(l)) throw new Error(`${where}: rule "${id}" level must be one of ${LEVELS.join(', ')}`);
    out[id] = l;
  }
  return out;
}

export function parseRuleFlag(value) {
  const m = /^([\w-]+)\s*[=:]\s*(\w+)$/.exec(value);
  if (!m) throw new Error(`--rule expects <id>=<off|info|warning|error>, got "${value}"`);
  return validateRules({ [m[1]]: m[2] }, '--rule');
}
