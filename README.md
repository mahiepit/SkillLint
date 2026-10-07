<div align="center">

# 🧪 SkillLint

**A linter for Agent Skills (`SKILL.md`): know your skill is valid, triggers well, and works in Claude Code, Codex, Cursor, Gemini CLI and GitHub Copilot — before your users find out it doesn't.**

**67 rules, each sourced from official docs · Portability matrix with `--target` · Claude Code plugin manifests · GitHub Action · Zero dependencies**

English · [Tiếng Việt](README.vi.md)

</div>

---

## ✨ Why SkillLint

Agent Skills are an open standard, but every agent reads them a little differently. A skill that works in Claude Code can be silently skipped by Codex (description over 500 characters), misnamed in Cursor (name ≠ folder), never discovered by Gemini CLI (nested one folder too deep), or broken on Linux because it was written on Windows. Agents rarely tell you — the skill just never triggers.

| | |
|---|---|
| 🧭 **Portability, not just syntax** | Knows where the agents differ: Codex's 500-character description limit, Cursor's folder-name identity, Gemini CLI's one-level discovery, Claude Code-only fields and `$ARGUMENTS`, which directories each agent scans. `--target claude,codex` checks only what matters for the agents you ship to. |
| 📚 **Every rule cites its source** | [docs/RULES.md](docs/RULES.md) documents each rule with the reason and a link to the spec or vendor doc it comes from. No invented style rules. |
| 🎯 **Catches skills that never trigger** | Descriptions that are too short, say *what* but not *when*, are written as "I can help you…", or contain XML tags. Unquoted `: ` and ` #` in YAML that break or silently truncate the description. |
| 🪟 **Catches Windows-made mistakes** | UTF-8 BOM, CRLF scripts (`bash\r: bad interpreter`), missing executable bit (read from the git index, so it works on Windows), links that only work on case-insensitive disks, backslash paths. |
| 🧩 **Plugin manifests too** | Validates `.claude-plugin/plugin.json` and `marketplace.json` like `claude plugin validate`, plus install-time failures it doesn't report (missing source directories, reserved names). |
| 🤖 **CI-ready** | GitHub Action with inline annotations and a job summary, `--json`, SARIF for code scanning, clear exit codes, `--fix` for safe fixes. |
| 🪶 **Zero dependencies** | One small Node.js package with its own strict YAML-subset parser. Runs anywhere with `npx`. |

## 🚀 Features

- **Discovers everything**: point it at one skill, a `skills/` folder or a whole repo. It finds `SKILL.md` in `.claude/skills`, `.agents/skills`, `.codex/skills`, `.cursor/skills`, `.gemini/skills`, `.github/skills`, `skills/` and anywhere else, plus Claude Code plugin manifests. Skips `node_modules`, `.git` and your ignore globs.
- **Spec compliance**: required fields, `name` format and length, `name` = folder, `description` ≤ 1024, `compatibility` ≤ 500, `metadata` string values, `allowed-tools` format, unknown fields with "did you mean" suggestions.
- **Trigger quality heuristics**: too-short descriptions, missing "Use when…", first/second person, vague names (`utils`, `helper`), Claude's listing budget.
- **Body and files**: 500-line and ~5000-token budgets, broken relative links (including case-only mismatches), missing `scripts/…` paths, links escaping the skill, absolute and user-specific paths, nested references, long references without a table of contents, unreferenced bundled files, time-sensitive wording.
- **Scripts**: missing shebang, not executable, CRLF line endings, Windows-only `.ps1/.bat` scripts.
- **Layout**: nesting depth, which agents will (not) discover the skill's directory, duplicate names.
- **Output**: colored human output with `file:line:col`, rule id and a fix hint; `--json`; `--format github`; `--format sarif` / `--sarif file`.
- **Configurable**: `--target`, `--rule id=off|info|warning|error`, `--ignore`, `.skilllintrc.json`, and `<!-- skilllint-disable rule-id -->` inside a skill.

## 📥 Install

Requirements: [Node.js 18+](https://nodejs.org). No other dependencies.

### Option 1 — run without installing
```bash
npx github:mahiepit/SkillLint .
```

### Option 2 — install the command
```bash
npm install -g github:mahiepit/SkillLint
skilllint .
```

### Option 3 — as a Claude Code plugin (CLI + a skill that teaches the agent to write and lint skills)
```
/plugin marketplace add mahiepit/SkillLint
/plugin install skilllint@skilllint
```
For Codex, Cursor, Gemini CLI or Copilot, copy [`skills/writing-agent-skills`](skills/writing-agent-skills) into `.agents/skills/` (or your agent's skills folder).

## 🖱️ Quick reference

| Task | Command |
|---|---|
| Lint the current repository | `skilllint` |
| Lint one skill | `skilllint .claude/skills/my-skill` |
| Only check what matters for some agents | `skilllint --target claude,codex` |
| Apply safe fixes | `skilllint --fix` |
| Fail on warnings too | `skilllint --strict` (or `--max-warnings 10`) |
| Errors only | `skilllint --quiet` |
| JSON / GitHub annotations / SARIF | `--json` · `--format github` · `--format sarif` or `--sarif out.sarif` |
| Turn a rule off or up | `--rule unreferenced-file=off` · `--rule name-vague=error` |
| Skip paths | `--ignore "vendor/**"` |
| Show all rules and the agents they matter for | `skilllint --list-rules` |

Targets: `claude` (Claude Code), `codex` (OpenAI Codex), `cursor`, `gemini` (Gemini CLI), `copilot` (GitHub Copilot), `spec` (agentskills.io / `skills-ref`), or `all` (default).

Exit codes: `0` no errors · `1` errors (or warnings with `--strict` / `--max-warnings`) · `2` invalid usage.

**Config file** — `.skilllintrc.json` (or `skilllint.config.json`) in the working directory:
```json
{
  "targets": ["claude", "codex", "cursor"],
  "rules": { "unreferenced-file": "off", "description-person": "error" },
  "ignore": ["vendor/**", "tests/fixtures/**"]
}
```

## 🔍 Example output

Real output from the test fixtures in this repo (`cd tests/fixtures && skilllint fields invalid-yaml codex-description`):

```text
codex-description/codex-desc/SKILL.md
  3:1  warning  `description` is 577 characters; the Codex skill loader rejects descriptions over 500.  description-too-long-codex
                fix: Keep it under 500 characters to load in Codex as well.

fields/field-mix/SKILL.md
  4:1   warning  Unknown frontmatter field `licence`; no supported agent reads it (did you mean `license`?).  unknown-field
                 fix: Put custom data under `metadata:` instead.
  5:1   warning  `model` is only understood by Claude Code; OpenAI Codex, Cursor, Gemini CLI, GitHub Copilot ignore it; it is not in the Agent Skills spec, so `skills-ref validate` and Claude skill uploads reject it.  non-portable-field
                 fix: Keep it only if you target Claude Code, or limit checks with --target claude.
  6:1   warning  `context` is only understood by Claude Code; OpenAI Codex, Cursor, Gemini CLI, GitHub Copilot ignore it; it is not in the Agent Skills spec, so `skills-ref validate` and Claude skill uploads reject it.  non-portable-field
                 fix: Keep it only if you target Claude Code, or limit checks with --target claude.
  7:1   error    `effort` must be one of low, medium, high, xhigh, max, but it is "extreme".  field-type
                 fix: effort: low
  7:1   warning  `effort` is only understood by Claude Code; OpenAI Codex, Cursor, Gemini CLI, GitHub Copilot ignore it; it is not in the Agent Skills spec, so `skills-ref validate` and Claude skill uploads reject it.  non-portable-field
                 fix: Keep it only if you target Claude Code, or limit checks with --target claude.
  8:1   warning  `when_to_use` is only understood by Claude Code; OpenAI Codex, Cursor, Gemini CLI, GitHub Copilot ignore it; it is not in the Agent Skills spec, so `skills-ref validate` and Claude skill uploads reject it.  non-portable-field
                 fix: Keep it only if you target Claude Code, or limit checks with --target claude.
  9:1   warning  `allowed-tools` is a YAML list; the Agent Skills spec defines it as a space-separated string (Claude Code accepts both).  allowed-tools-format
                 fix: Use: allowed-tools: Read Grep
  13:3  warning  `metadata.version` is a number (1), but metadata values must be strings; unquoted versions like 1.0 or 1.10 are silently turned into numbers.  metadata-invalid
                 fix: Quote it: version: "1.0"
  14:1  error    `compatibility` is empty; omit it unless the skill has environment requirements.  compatibility-invalid
                 fix: Example: compatibility: Requires git, docker and network access

invalid-yaml/colon-skill/SKILL.md
  3:43  error    Invalid YAML: mapping values are not allowed here: a plain value contains ": " (colon + space) or ends with ":"; wrap the whole value in quotes.  frontmatter-invalid-yaml
                 fix: Agents skip skills whose frontmatter does not parse. Quoting the value usually fixes it: description: "..."

✖ 11 problems (3 errors, 8 warnings, 0 info) in 3 skills.
  Targets: Claude Code, OpenAI Codex, Cursor, Gemini CLI, GitHub Copilot, Agent Skills spec. Rule docs: https://github.com/mahiepit/SkillLint/blob/main/docs/RULES.md
```

The same skills with `--target claude` — the Claude-only fields and the Codex limit no longer matter, real errors still do:

```text
fields/field-mix/SKILL.md
  4:1  warning  Unknown frontmatter field `licence`; no supported agent reads it (did you mean `license`?).  unknown-field
                fix: Put custom data under `metadata:` instead.
  7:1  error    `effort` must be one of low, medium, high, xhigh, max, but it is "extreme".  field-type
                fix: effort: low

invalid-yaml/colon-skill/SKILL.md
  3:43  error    Invalid YAML: mapping values are not allowed here: a plain value contains ": " (colon + space) or ends with ":"; wrap the whole value in quotes.  frontmatter-invalid-yaml
                 fix: Agents skip skills whose frontmatter does not parse. Quoting the value usually fixes it: description: "..."

✖ 3 problems (2 errors, 1 warning, 0 info) in 3 skills.
  Targets: Claude Code. Rule docs: https://github.com/mahiepit/SkillLint/blob/main/docs/RULES.md
```

## 🤖 GitHub Action

```yaml
# .github/workflows/skills.yml
name: skills
on: [push, pull_request]
jobs:
  skilllint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mahiepit/SkillLint@v1
        with:
          path: .                 # files or folders, space-separated
          target: claude,codex    # optional, default: all
```

Problems appear as annotations on the pull request diff, and a summary table is added to the job page. Inputs: `path`, `target`, `strict`, `max-warnings`, `sarif`, `args` (any extra CLI flags), `node-version`. Outputs: `errors`, `warnings`.

To show results in GitHub code scanning:
```yaml
      - uses: mahiepit/SkillLint@v1
        with:
          sarif: skilllint.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: skilllint.sarif
```

Any other CI: `npx --yes github:mahiepit/SkillLint . --strict` (exit code 1 on problems).

## 📏 Rules & portability matrix

67 rules in ten groups: file & frontmatter, `name`, `description`, other fields, body, references & files, scripts, layout, `plugin.json`, `marketplace.json`. Each one is mapped to the agents it matters for — an excerpt:

| Rule | Severity | Claude Code | Codex | Cursor | Gemini CLI | Copilot | Spec |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `frontmatter-invalid-yaml` | error | ● | ● | ● | ● | ● | ● |
| `name-dir-mismatch` | error |  |  | ● | ● | ● | ● |
| `description-too-long-codex` | warning |  | ● |  |  |  |  |
| `non-portable-field` | warning | ± | ± | ± | ± | ± | ± |
| `agent-specific-syntax` | warning |  | ● | ● | ● | ● | ● |
| `skill-nesting-depth` | warning | ● |  |  | ● |  |  |
| `script-crlf` | error | ● | ● | ● | ● | ● | ● |
| `plugin-path` | error | ● |  |  |  |  |  |

**Full matrix, rationale and source links for every rule: [docs/RULES.md](docs/RULES.md).** Run `skilllint --list-rules` to print it.

## ⚖️ Alternatives

SkillLint is not the only tool; pick what fits:

- **[skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref)** (Python) — the reference validator from the Agent Skills project. It is the ground truth for spec compliance (frontmatter fields and naming). SkillLint implements the same checks and adds per-agent differences, quality heuristics, files/scripts checks, plugin manifests and CI formats.
- **[skill-check](https://www.npmjs.com/package/skill-check)** (npm) — a broader quality tool with scoring, more output formats, watch mode and security scanning. Use it if you want a score and an HTML report.
- **[agent-skills-lint](https://github.com/swarmclawai/agent-skills-lint)** (npm) — per-agent validation combined with installing skills into each agent's directory and generating an index.
- **[skills_lint](https://pub.dev/packages/skills_lint)** (Dart) — a static analyzer for skills in the Dart/Flutter ecosystem.
- **`claude plugin validate`** — the authoritative check for Claude Code plugin manifests. SkillLint mirrors it so you can run it in CI without Claude Code, but run the official command before publishing too.

SkillLint's focus: a portability matrix where every rule cites official docs, `--target` to tailor checks, Claude Code plugin/marketplace manifests, Windows pitfalls, and zero dependencies.

## ❤️ Support the project

SkillLint is free and always will be. If it saves you time, a donation keeps it maintained and improving. Thank you!

<table>
<tr>
<td align="center"><b>PayPal</b><br><img src="docs/img/donate-paypal.svg" width="180" alt="PayPal QR"><br><a href="https://paypal.me/thaogia">paypal.me/thaogia</a></td>
<td align="center"><b>BNB (BEP-20) / ETH (ERC-20)</b><br><img src="docs/img/donate-crypto.svg" width="180" alt="BNB / ETH QR"><br><code>0xd09c2E60cbC8526976C436e316630FA64296E824</code></td>
</tr>
</table>

Please double-check the network (BNB Smart Chain or Ethereum) before sending crypto.

## 🧩 How it works

```
paths ──► discover ──► SKILL.md ──► frontmatter + strict YAML parser ──► rules ──► --fix ──► stylish / json / github / sarif
            │                                                            ▲
            └──► .claude-plugin/plugin.json, marketplace.json ───────────┘      filtered by --target, config, inline disables
```

- The YAML parser is deliberately as strict as PyYAML/js-yaml, so frontmatter that would break an agent's loader fails here too, and it records the cases that parse but not as intended (` #` comments, YAML 1.1 booleans).
- File modes and line endings are read from the git index when available, so checks are correct on Windows checkouts.
- `--fix` only applies edits that cannot change meaning: removing a BOM, trailing whitespace, CRLF → LF, `chmod +x`, and normalizing `name` when the result equals the folder name.

```
bin/skilllint.js          CLI entry point
src/yaml.js               zero-dependency YAML-subset parser
src/rules/skill.js        SKILL.md, body, references, scripts, layout rules
src/rules/plugin.js       plugin.json and marketplace.json rules
src/rules/registry.js     rule metadata: severity, targets, sources
src/targets.js            what each agent supports and where it looks
src/formatters/           stylish, json, github, sarif output
skills/writing-agent-skills/   the skill shipped with the Claude Code plugin
action.yml                composite GitHub Action
docs/RULES.md             every rule, its rationale and sources
```

Development: `npm test` (Node's built-in test runner, fixtures in `tests/fixtures`), `npm run lint:self` (SkillLint lints this repo).

## 📄 License

[MIT](LICENSE) © Thảo Gia.
SkillLint is an independent project, not affiliated with Anthropic, OpenAI, Anysphere (Cursor), Google or GitHub. Product names are used only to describe compatibility.
