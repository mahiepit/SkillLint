// Command-line interface.
import fs from 'node:fs';
import path from 'node:path';
import { lint, summarize } from './linter.js';
import { parseTargets, ALL_TARGETS } from './targets.js';
import { findConfig, loadConfig, parseRuleFlag } from './config.js';
import { FORMATS, VERSION, formatGithub, formatJson, formatMarkdownSummary, formatRuleList, formatSarif, formatStylish } from './formatters/index.js';

const HELP = `SkillLint ${VERSION} - lint Agent Skills (SKILL.md) and Claude Code plugin manifests

Usage
  skilllint [paths...] [options]

  paths   skill folders, SKILL.md files, a skills/ directory or a whole repo
          (default: current directory; SKILL.md files and .claude-plugin/*.json
          are discovered recursively)

Options
  -t, --target <list>    agents to check for: ${ALL_TARGETS.join(',')} or all
                         (default: all)
  -f, --format <name>    ${FORMATS.join(' | ')} (default: stylish)
      --json             same as --format json
      --sarif <file>     also write a SARIF 2.1.0 report to <file>
      --fix              apply safe automatic fixes, then report what is left
      --strict           exit with code 1 on warnings too
      --max-warnings <n> exit with code 1 if there are more than n warnings
  -q, --quiet            report errors only
      --rule <id=level>  override a rule: off | info | warning | error (repeatable)
      --ignore <glob>    skip paths matching the glob (repeatable)
  -c, --config <file>    config file (default: .skilllintrc.json or skilllint.config.json)
      --no-config        ignore config files
      --list-rules       print every rule and the agents it matters for
      --color / --no-color
  -v, --version          print the version
  -h, --help             print this help

Exit codes
  0  no errors        1  errors found (or warnings with --strict/--max-warnings)
  2  invalid usage or crash

Examples
  skilllint                              lint the current repository
  skilllint .claude/skills/my-skill      lint one skill
  skilllint --target claude,codex        only rules that matter for Claude Code and Codex
  skilllint --format github              GitHub Actions annotations
  npx github:mahiepit/SkillLint skills/  run without installing

Docs: https://github.com/mahiepit/SkillLint/blob/main/docs/RULES.md
`;

export function parseArgs(argv) {
  const opts = { paths: [], rules: {}, ignore: [], format: 'stylish', color: undefined };
  const needValue = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--') {
      opts.paths.push(...argv.slice(i + 1));
      break;
    }
    let inline = null;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    const value = (flag) => {
      if (inline !== null) return inline;
      const v = needValue(i, flag);
      i++;
      return v;
    };
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '-t':
      case '--target':
      case '--targets':
        opts.targets = parseTargets(value(arg));
        break;
      case '-f':
      case '--format': {
        const f = value(arg);
        if (!FORMATS.includes(f)) throw new Error(`Unknown format "${f}" (expected ${FORMATS.join(', ')})`);
        opts.format = f;
        break;
      }
      case '--json':
        opts.format = 'json';
        break;
      case '--sarif':
        opts.sarif = value(arg);
        break;
      case '--fix':
        opts.fix = true;
        break;
      case '--strict':
        opts.strict = true;
        break;
      case '--max-warnings': {
        const n = Number(value(arg));
        if (!Number.isInteger(n) || n < 0) throw new Error('--max-warnings needs a whole number');
        opts.maxWarnings = n;
        break;
      }
      case '-q':
      case '--quiet':
        opts.quiet = true;
        break;
      case '--rule':
        Object.assign(opts.rules, parseRuleFlag(value(arg)));
        break;
      case '--ignore':
        opts.ignore.push(value(arg));
        break;
      case '-c':
      case '--config':
        opts.config = value(arg);
        break;
      case '--no-config':
        opts.noConfig = true;
        break;
      case '--list-rules':
        opts.listRules = true;
        break;
      case '--color':
        opts.color = true;
        break;
      case '--no-color':
        opts.color = false;
        break;
      default:
        if (arg.startsWith('-') && arg !== '-') throw new Error(`Unknown option ${arg} (see --help)`);
        opts.paths.push(arg);
    }
  }
  return opts;
}

function useColor(opts, stream) {
  if (opts.color !== undefined) return opts.color;
  if ('NO_COLOR' in process.env) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}

/**
 * Run the CLI. Returns the exit code instead of exiting, for testability.
 * @param {string[]} argv
 * @param {{cwd?: string, stdout?: {write: Function, isTTY?: boolean}, stderr?: {write: Function}, env?: object}} io
 */
export function run(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const cwd = io.cwd || process.cwd();
  const env = io.env || process.env;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr.write(`skilllint: ${err.message}\n`);
    return 2;
  }
  if (opts.help) {
    stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (opts.listRules) {
    stdout.write(formatRuleList({ color: useColor(opts, stdout) }));
    return 0;
  }

  try {
    let config = null;
    if (opts.config) config = loadConfig(path.resolve(cwd, opts.config));
    else if (!opts.noConfig) {
      const found = findConfig(cwd);
      if (found) config = loadConfig(found);
    }
    const targets = opts.targets || (config && config.targets ? parseTargets(config.targets) : parseTargets('all'));
    const result = lint({
      cwd,
      paths: opts.paths,
      targets,
      rules: { ...(config ? config.rules : {}), ...opts.rules },
      ignore: [...(config ? config.ignore : []), ...opts.ignore],
      ignoreBase: config ? config.dir : undefined,
      fix: opts.fix,
    });

    let output;
    if (opts.format === 'json') output = formatJson(result);
    else if (opts.format === 'sarif') output = formatSarif(result);
    else if (opts.format === 'github') output = formatGithub(result, { quiet: opts.quiet });
    else output = formatStylish(result, { color: useColor(opts, stdout), quiet: opts.quiet });
    stdout.write(output);

    if (opts.sarif) fs.writeFileSync(path.resolve(cwd, opts.sarif), formatSarif(result), 'utf8');

    const s = summarize(result.findings);
    if (opts.format === 'github') {
      if (env.GITHUB_STEP_SUMMARY) {
        try {
          fs.appendFileSync(env.GITHUB_STEP_SUMMARY, formatMarkdownSummary(result));
        } catch {
          /* not fatal */
        }
      }
      if (env.GITHUB_OUTPUT) {
        try {
          fs.appendFileSync(env.GITHUB_OUTPUT, `errors=${s.errors}\nwarnings=${s.warnings}\ninfos=${s.infos}\n`);
        } catch {
          /* not fatal */
        }
      }
    }

    if (result.stats.skills + result.stats.plugins + result.stats.marketplaces === 0 && !result.problems.length) {
      stderr.write('skilllint: no SKILL.md or .claude-plugin manifests found\n');
    }
    if (result.problems.some((p) => /no such file/.test(p))) return 2;
    if (s.errors > 0) return 1;
    if (opts.strict && s.warnings > 0) return 1;
    if (opts.maxWarnings !== undefined && s.warnings > opts.maxWarnings) return 1;
    return 0;
  } catch (err) {
    stderr.write(`skilllint: ${err.message}\n`);
    if (env.SKILLLINT_DEBUG) stderr.write(`${err.stack}\n`);
    return 2;
  }
}
