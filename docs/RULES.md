# SkillLint rules

Every rule below is based on the published documentation of the Agent Skills standard or of an agent that implements it. Each section links its sources. Run `skilllint --list-rules` for the same matrix in your terminal.

- [How the agents differ](#how-the-agents-differ)
- [Portability matrix](#portability-matrix)
- [Configuring rules](#configuring-rules)
- Rules: [File and frontmatter](#file-and-frontmatter) · [name](#name) · [description](#description) · [Other fields](#other-fields) · [Body](#body) · [References and files](#references-and-files) · [Scripts](#scripts) · [Layout](#layout) · [Claude Code plugin.json](#claude-code-pluginjson) · [Claude Code marketplace.json](#claude-code-marketplacejson)

## How the agents differ

Sources checked on 2026-10-07.

| | Agent Skills spec | Claude Code | OpenAI Codex | Cursor | Gemini CLI | GitHub Copilot |
|---|---|---|---|---|---|---|
| Docs | [agentskills.io/specification](https://agentskills.io/specification) | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) | [learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills) | [cursor.com/docs/skills](https://cursor.com/docs/skills) | [geminicli.com/docs/cli/skills](https://geminicli.com/docs/cli/skills/) | [docs.github.com … create-skills](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills) |
| `name` | required, 1-64, `a-z0-9-`, must match folder | optional (defaults to folder) | required (loader max 100) | required, must match folder | required, "should match" folder | required, lowercase + hyphens |
| `description` | required, 1-1024 | recommended (falls back to first paragraph); listing truncated at 1536 with `when_to_use` | required (loader max 500) | required | required | required |
| Extra fields | `license`, `compatibility` (≤500), `metadata` (string→string), `allowed-tools` (experimental) | many: `when_to_use`, `model`, `context`, `hooks`, `paths`, ... | ignored; UI metadata goes in `agents/openai.yaml` | `paths`, `disable-model-invocation`, `icon`, `color`, `metadata` | ignored | `license`, `allowed-tools` |
| Project dirs | – | `.claude/skills` | `.agents/skills` (CWD up to repo root) | `.cursor/skills`, `.agents/skills`, `.claude/skills`, `.codex/skills` | `.gemini/skills`, `.agents/skills` | `.github/skills`, `.claude/skills`, `.agents/skills` |
| Nesting | – | `skills/<name>/SKILL.md` | recursive | per folder | `SKILL.md` or `*/SKILL.md` only | per folder |
| Body syntax | plain Markdown | `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `` !`cmd` `` are expanded | plain | plain | plain | plain |

The Claude API / claude.ai upload additionally rejects `name` values containing "anthropic" or "claude", XML tags in `name` or `description`, and frontmatter keys outside the six spec fields ([best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), [Claude Code skills](https://code.claude.com/docs/en/skills)).

## Portability matrix

● = the rule matters for this target. ± = depends on the field or location (the message names the affected agents). 🔧 = `--fix` can repair it. With `--target`, a rule only runs if it matters for at least one selected target.

| Rule | Severity | Fix | Claude Code | Codex | Cursor | Gemini CLI | Copilot | Spec |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| [`skill-md-filename`](#skill-md-filename) | error |  | ● | ● | ● | ● | ● | ● |
| [`frontmatter-missing`](#frontmatter-missing) | error |  | ● | ● | ● | ● | ● | ● |
| [`frontmatter-unterminated`](#frontmatter-unterminated) | error |  | ● | ● | ● | ● | ● | ● |
| [`frontmatter-invalid-yaml`](#frontmatter-invalid-yaml) | error |  | ● | ● | ● | ● | ● | ● |
| [`frontmatter-delimiter`](#frontmatter-delimiter) | error | 🔧 |  |  |  | ● |  | ● |
| [`file-bom`](#file-bom) | error | 🔧 | ● | ● | ● | ● | ● | ● |
| [`yaml-gotcha`](#yaml-gotcha) | warning |  | ● | ● | ● | ● | ● | ● |
| [`trailing-whitespace`](#trailing-whitespace) | info | 🔧 | ● | ● | ● | ● | ● | ● |
| [`crlf-line-endings`](#crlf-line-endings) | info | 🔧 | ● | ● | ● | ● | ● | ● |
| [`name-missing`](#name-missing) | error |  |  | ● | ● | ● | ● | ● |
| [`name-format`](#name-format) | error | 🔧 | ● | ● | ● | ● | ● | ● |
| [`name-too-long`](#name-too-long) | error |  | ● |  | ● |  | ● | ● |
| [`name-dir-mismatch`](#name-dir-mismatch) | error |  |  |  | ● | ● | ● | ● |
| [`name-reserved-word`](#name-reserved-word) | warning |  | ● |  |  |  |  |  |
| [`name-vague`](#name-vague) | warning |  | ● | ● | ● | ● | ● | ● |
| [`description-missing`](#description-missing) | error |  |  | ● | ● | ● | ● | ● |
| [`description-too-long`](#description-too-long) | error |  | ● |  |  |  |  | ● |
| [`description-too-long-codex`](#description-too-long-codex) | warning |  |  | ● |  |  |  |  |
| [`description-too-short`](#description-too-short) | warning |  | ● | ● | ● | ● | ● | ● |
| [`description-no-trigger`](#description-no-trigger) | warning |  | ● | ● | ● | ● | ● | ● |
| [`description-person`](#description-person) | warning |  | ● | ● | ● | ● | ● | ● |
| [`description-xml-tags`](#description-xml-tags) | error |  | ● |  |  |  |  |  |
| [`description-listing-budget`](#description-listing-budget) | warning |  | ● |  |  |  |  |  |
| [`field-type`](#field-type) | error |  | ● | ● | ● | ● | ● | ● |
| [`compatibility-invalid`](#compatibility-invalid) | error |  |  |  |  |  |  | ● |
| [`metadata-invalid`](#metadata-invalid) | warning |  |  |  | ● |  |  | ● |
| [`allowed-tools-format`](#allowed-tools-format) | warning |  |  | ● | ● | ● | ● | ● |
| [`license-file-missing`](#license-file-missing) | warning |  |  |  |  |  |  | ● |
| [`unknown-field`](#unknown-field) | warning |  | ● | ● | ● | ● | ● | ● |
| [`non-portable-field`](#non-portable-field) | warning |  | ± | ± | ± | ± | ± | ± |
| [`body-empty`](#body-empty) | warning |  | ● | ● | ● | ● | ● | ● |
| [`body-too-long`](#body-too-long) | warning |  | ● | ● | ● | ● | ● | ● |
| [`body-token-budget`](#body-token-budget) | warning |  | ● |  |  |  |  | ● |
| [`agent-specific-syntax`](#agent-specific-syntax) | warning |  |  | ● | ● | ● | ● | ● |
| [`time-sensitive`](#time-sensitive) | info |  | ● |  |  |  |  |  |
| [`link-broken`](#link-broken) | error |  | ● | ● | ● | ● | ● | ● |
| [`path-reference-missing`](#path-reference-missing) | warning |  | ● | ● | ● | ● | ● | ● |
| [`link-escapes-skill`](#link-escapes-skill) | warning |  | ● | ● | ● | ● | ● | ● |
| [`absolute-path`](#absolute-path) | warning |  | ● | ● | ● | ● | ● | ● |
| [`windows-path`](#windows-path) | warning |  | ● | ● | ● | ● | ● | ● |
| [`nested-reference`](#nested-reference) | info |  | ● |  |  |  |  | ● |
| [`reference-no-toc`](#reference-no-toc) | info |  | ● |  |  |  |  |  |
| [`unreferenced-file`](#unreferenced-file) | info |  | ● | ● | ● | ● | ● | ● |
| [`script-no-shebang`](#script-no-shebang) | warning |  | ● | ● | ● | ● | ● | ● |
| [`script-not-executable`](#script-not-executable) | warning |  | ● | ● | ● | ● | ● | ● |
| [`script-crlf`](#script-crlf) | error | 🔧 | ● | ● | ● | ● | ● | ● |
| [`script-windows-only`](#script-windows-only) | info |  | ● | ● | ● | ● | ● | ● |
| [`skill-nesting-depth`](#skill-nesting-depth) | warning |  | ● |  |  | ● |  |  |
| [`skill-location`](#skill-location) | info |  | ± | ± | ± | ± | ± | ± |
| [`duplicate-skill-name`](#duplicate-skill-name) | warning |  | ● | ● | ● | ● | ● | ● |
| [`plugin-json-invalid`](#plugin-json-invalid) | error |  | ● |  |  |  |  |  |
| [`plugin-name`](#plugin-name) | error |  | ● |  |  |  |  |  |
| [`plugin-name-style`](#plugin-name-style) | warning |  | ● |  |  |  |  |  |
| [`plugin-name-reserved`](#plugin-name-reserved) | error |  | ● |  |  |  |  |  |
| [`plugin-field-type`](#plugin-field-type) | error |  | ● |  |  |  |  |  |
| [`plugin-path`](#plugin-path) | error |  | ● |  |  |  |  |  |
| [`plugin-unknown-field`](#plugin-unknown-field) | warning |  | ● |  |  |  |  |  |
| [`plugin-recommended-fields`](#plugin-recommended-fields) | warning |  | ● |  |  |  |  |  |
| [`plugin-misplaced-component`](#plugin-misplaced-component) | error |  | ● |  |  |  |  |  |
| [`marketplace-json-invalid`](#marketplace-json-invalid) | error |  | ● |  |  |  |  |  |
| [`marketplace-required-fields`](#marketplace-required-fields) | error |  | ● |  |  |  |  |  |
| [`marketplace-name`](#marketplace-name) | error |  | ● |  |  |  |  |  |
| [`marketplace-plugin-entry`](#marketplace-plugin-entry) | error |  | ● |  |  |  |  |  |
| [`marketplace-source`](#marketplace-source) | error |  | ● |  |  |  |  |  |
| [`marketplace-consistency`](#marketplace-consistency) | warning |  | ● |  |  |  |  |  |
| [`marketplace-unknown-field`](#marketplace-unknown-field) | warning |  | ● |  |  |  |  |  |
| [`marketplace-recommended-fields`](#marketplace-recommended-fields) | warning |  | ● |  |  |  |  |  |

## Configuring rules

- Per run: `--rule name-vague=off`, `--rule unreferenced-file=error` (levels: `off`, `info`, `warning`, `error`).
- Per repository: `.skilllintrc.json` (or `skilllint.config.json`) in the working directory:

  ```json
  {
    "targets": ["claude", "codex"],
    "rules": { "unreferenced-file": "off" },
    "ignore": ["vendor/**", "tests/fixtures/**"]
  }
  ```

- Per skill: an HTML comment anywhere in `SKILL.md` disables rules for that skill and its files: `<!-- skilllint-disable name-vague, description-no-trigger -->`, or `<!-- skilllint-disable -->` for all rules.

---

## File and frontmatter

### `skill-md-filename`

**error** · all targets

The skill file must be named exactly `SKILL.md`. `skill.md` or `Skill.md` works on case-insensitive Windows/macOS disks and silently disappears on Linux, in CI and in containers. Copilot's docs say the filename "must be exactly SKILL.md".

Sources: [Agent Skills spec](https://agentskills.io/specification) · [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills)

### `frontmatter-missing`

**error** · all targets

`SKILL.md` must start with YAML frontmatter (`---` on line 1). Frontmatter that starts after a heading or a blank line is not frontmatter. Codex, Gemini CLI, Cursor and Copilot skip such skills; Claude Code falls back to the folder name and first paragraph, which rarely triggers well.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude Code skills](https://code.claude.com/docs/en/skills) · [Codex](https://learn.chatgpt.com/docs/build-skills)

### `frontmatter-unterminated`

**error** · all targets

The frontmatter opens with `---` but never closes, so the whole file is read as YAML and fails.

Sources: [Agent Skills spec](https://agentskills.io/specification)

### `frontmatter-invalid-yaml`

**error** · all targets

The frontmatter does not parse as YAML, or it is not a `key: value` mapping. The most common cause is an unquoted description that contains `: ` (colon + space), e.g. `description: Use when: the user ...`, which PyYAML, js-yaml and the agents' loaders all reject. Also reported: duplicate keys, tab indentation, unterminated quotes, invalid escapes. Fix by quoting the value.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [YAML 1.2](https://yaml.org/spec/1.2.2/)

### `frontmatter-delimiter`

**error** · Gemini CLI, spec · 🔧

A delimiter line such as `---␠␠` (trailing spaces). Gemini CLI parses frontmatter with the regex `^---\r?\n([\s\S]*?)\r?\n---`, which does not match a delimiter with trailing whitespace, so the skill is ignored.

Sources: [Gemini CLI skill loader](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/skills/skillLoader.ts)

### `file-bom`

**error** · all targets · 🔧

A UTF-8 byte order mark before `---`. Loaders that check that the file starts with `---` (Gemini CLI's regex, the `skills-ref` reference validator) do not see the frontmatter. Windows editors (Notepad, PowerShell 5 `Set-Content -Encoding utf8`) add it silently.

Sources: [Gemini CLI skill loader](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/skills/skillLoader.ts) · [Agent Skills spec](https://agentskills.io/specification)

### `yaml-gotcha`

**warning** · all targets

YAML that parses, but differently from how it reads:

- ` #` starts a comment, so `description: Fixes bug #12 and #13` becomes `Fixes bug`.
- `yes`, `no`, `on`, `off` are booleans in YAML 1.1 parsers (PyYAML, used by `skills-ref`) but strings in YAML 1.2.
- Anchors, aliases and tags (`&a`, `*a`, `!tag`) are not handled consistently by skill loaders.

Sources: [YAML 1.2](https://yaml.org/spec/1.2.2/)

### `trailing-whitespace`

**info** · all targets · 🔧

Trailing spaces in frontmatter lines. Harmless for most parsers, but they end up inside folded values and make diffs noisy.

Sources: [YAML 1.2](https://yaml.org/spec/1.2.2/)

### `crlf-line-endings`

**info** · all targets · 🔧

`SKILL.md` is committed with CRLF line endings. Loaders handle it, but LF is the portable choice and CRLF often signals a missing `.gitattributes`. When the file is tracked by git, SkillLint checks the line endings stored in the index (what you publish), not the Windows working copy.

Sources: [gitattributes](https://git-scm.com/docs/gitattributes)

## name

### `name-missing`

**error** · Codex, Cursor, Gemini CLI, Copilot, spec

`name` is required by the spec and by every agent except Claude Code (which defaults to the folder name).

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Codex](https://learn.chatgpt.com/docs/build-skills) · [Cursor](https://cursor.com/docs/skills) · [Gemini CLI](https://geminicli.com/docs/cli/creating-skills/) · [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills)

### `name-format`

**error** · all targets · 🔧

`name` may only contain lowercase `a-z`, digits and hyphens, must not start or end with a hyphen and must not contain `--`. Uppercase, underscores, spaces, dots, non-ASCII letters and XML tags are rejected. `--fix` rewrites the name only when its kebab-case form equals the folder name (for example `PDF_Tools` in folder `pdf-tools`).

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) · [Cursor](https://cursor.com/docs/skills) · [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills)

### `name-too-long`

**error** · Claude Code, Cursor, Copilot, spec (and Codex over 100)

The spec and Claude limit `name` to 64 characters. Codex's loader allows 100.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) · [Codex loader](https://github.com/openai/codex/blob/rust-v0.65.0/codex-rs/core/src/skills/loader.rs)

### `name-dir-mismatch`

**error** · Cursor, Gemini CLI, Copilot, spec

`name` must equal the skill folder name. Cursor uses the folder name as the skill's identity, `skills-ref validate` rejects a mismatch, and Gemini/Copilot document that it should match. Claude Code and Codex accept a mismatch, so the rule is silent with `--target claude,codex`.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Cursor](https://cursor.com/docs/skills) · [Gemini CLI](https://geminicli.com/docs/cli/creating-skills/) · [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref)

### `name-reserved-word`

**warning** · Claude Code

Claude rejects skill names containing the reserved words "anthropic" or "claude" when skills are uploaded to the Claude API / claude.ai.

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `name-vague`

**warning** · all targets

Names such as `helper`, `utils`, `tools`, `data`, `files`, `documents` do not tell skills apart. Anthropic recommends gerund names such as `processing-pdfs`.

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## description

### `description-missing`

**error** · Codex, Cursor, Gemini CLI, Copilot, spec

`description` is required and must be non-empty. It is the only text agents read to decide whether to load the skill. Claude Code falls back to the first paragraph of the body.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Codex](https://learn.chatgpt.com/docs/build-skills) · [Cursor](https://cursor.com/docs/skills) · [Gemini CLI](https://geminicli.com/docs/cli/creating-skills/) · [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills)

### `description-too-long`

**error** · Claude Code, spec

At most 1024 characters.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `description-too-long-codex`

**warning** · Codex

Codex's skill loader defines `MAX_DESCRIPTION_LEN = 500` and reports longer descriptions as invalid ("exceeds maximum length of 500 characters"). A spec-valid 501-1024 character description therefore does not load in Codex. (Reported as a warning because the current Codex docs no longer state the limit; the loader source does.)

Sources: [Codex loader (rust-v0.65.0)](https://github.com/openai/codex/blob/rust-v0.65.0/codex-rs/core/src/skills/loader.rs) · [Codex skills doc (rust-v0.65.0)](https://github.com/openai/codex/blob/rust-v0.65.0/docs/skills.md)

### `description-too-short`

**warning** · all targets

Fewer than 40 characters or 6 words — e.g. the spec's own "poor example", `Helps with PDFs.` An agent choosing among 100+ skills cannot match that to a task.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `description-no-trigger`

**warning** · all targets

The description says what the skill does but not when to use it. Every vendor asks for both: "Describes what the skill does and when to use it" (spec), "Use when ..." (Claude), "Explain when this skill should and should not trigger" (Codex). SkillLint looks for phrases like "Use when", "Use for", "when the user", "if the user", "whenever", and their equivalents in Vietnamese ("Dùng khi"), Chinese ("当用户", "用于"), Japanese ("場合に"), Korean ("때 사용"), Spanish, Portuguese, French and German.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) · [Codex](https://learn.chatgpt.com/docs/build-skills) · [Gemini CLI](https://geminicli.com/docs/cli/creating-skills/)

### `description-person`

**warning** · all targets

Descriptions are injected into the system prompt, so write them in the third person ("Processes Excel files"), not "I can help you ..." or "You can use this ...".

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `description-xml-tags`

**error** · Claude Code

Claude does not allow XML tags in `description` (or `name`). Placeholders like `<file>` count as tags.

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `description-listing-budget`

**warning** · Claude Code

Claude Code shows `description` + `when_to_use` in its skill listing and truncates the combined text at 1,536 characters. Put the key use case first.

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills)

## Other fields

### `field-type`

**error** · all targets

A field has the wrong YAML type or value: a numeric `name` (`name: 2048`), a list `description`, a non-string `license`. For Claude Code it also checks `disable-model-invocation` / `user-invocable` / `background` are booleans, `context` is `fork`, `effort` is `low|medium|high|xhigh|max`, `shell` is `bash|powershell`, `agent` is only used with `context: fork`; for Cursor that `color` is one of its badge colors.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude Code skills](https://code.claude.com/docs/en/skills) · [Cursor](https://cursor.com/docs/skills)

### `compatibility-invalid`

**error** · spec

If present, `compatibility` must be a non-empty string of at most 500 characters.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude Code skills](https://code.claude.com/docs/en/skills)

### `metadata-invalid`

**warning** · Cursor, spec

`metadata` must be a map of string keys to string values. Unquoted `version: 1.0` becomes the number `1` (and `1.10` becomes `1.1`); quote it.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Cursor](https://cursor.com/docs/skills)

### `allowed-tools-format`

**warning** · Codex, Cursor, Gemini CLI, Copilot, spec

The spec defines `allowed-tools` as a space-separated string (`Bash(git:*) Read`). Claude Code also accepts a YAML list; other tools may not.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude Code skills](https://code.claude.com/docs/en/skills)

### `license-file-missing`

**warning** · spec

`license` may name a bundled file ("Proprietary. LICENSE.txt has complete terms"). The file must exist next to `SKILL.md`.

Sources: [Agent Skills spec](https://agentskills.io/specification)

### `unknown-field`

**warning** · all targets

A frontmatter key that neither the spec nor any supported agent defines — usually a typo (`descripton`, `licence`). Agents ignore it; `skills-ref validate` and Claude uploads reject unexpected keys. SkillLint suggests the closest known field.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) · [Claude Code skills](https://code.claude.com/docs/en/skills) · [Cursor](https://cursor.com/docs/skills)

### `non-portable-field`

**warning** · depends on the field

A key outside the spec that only some agents understand. Reported only when at least one selected target does not support it:

| Field | Understood by |
|---|---|
| `when_to_use`, `argument-hint`, `arguments`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `shell` | Claude Code |
| `disable-model-invocation`, `paths` | Claude Code, Cursor |
| `icon`, `color` | Cursor |

Claude Code's docs note that these keys cause "Unexpected key" errors when the skill is uploaded outside Claude Code.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) · [Claude Code skills](https://code.claude.com/docs/en/skills) · [Cursor](https://cursor.com/docs/skills)

## Body

### `body-empty`

**warning** · all targets

No instructions after the frontmatter. Once activated, the skill gives the agent nothing to do.

Sources: [Agent Skills spec](https://agentskills.io/specification)

### `body-too-long`

**warning** · all targets

`SKILL.md` over 500 lines. The whole file is loaded on activation; the spec, Claude and Codex all recommend staying under 500 lines and moving details into referenced files.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) · [Codex](https://learn.chatgpt.com/docs/build-skills)

### `body-token-budget`

**warning** · Claude Code, spec

The body is over the spec's recommended 5,000 tokens (estimated at 4 characters per token). Claude Code also keeps at most 5,000 tokens per skill when compacting context.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude Code skills](https://code.claude.com/docs/en/skills)

### `agent-specific-syntax`

**warning** · Codex, Cursor, Gemini CLI, Copilot, spec

The body uses Claude Code-only substitutions: `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SESSION_ID}`, or dynamic context injection `` !`command` `` / ` ```! `. Other agents pass them to the model literally. Silent with `--target claude`.

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills)

### `time-sensitive`

**info** · Claude Code

Wording such as "before August 2025" or "as of 2024" goes stale. Anthropic recommends describing the current method and keeping old ones in an "Old patterns" section.

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## References and files

### `link-broken`

**error** · all targets

A relative Markdown link (`[guide](references/guide.md)`) or image points to a file that does not exist — including links that only work because Windows/macOS file systems ignore letter case (`References/Guide.md` vs `references/guide.md`). Links in code blocks are ignored. Checked in `SKILL.md` and every Markdown file in the skill.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `path-reference-missing`

**warning** · all targets

A bare path in the text or in a code block — `scripts/extract.py`, `references/api.md`, `assets/...` — that does not exist in the skill. The spec references bundled files exactly this way ("Run the extraction script: scripts/extract.py"). `${CLAUDE_SKILL_DIR}/` prefixes are understood. To avoid noise, globs and placeholders (`references/layouts*.md`, `scripts/<name>.py`), extension-less prose ("better scripts/tools") and lines that talk about examples ("e.g.", "for example", "would") are skipped — except when a missing extension-less path has an obvious match, e.g. `python scripts/check_fields` when only `scripts/check_fields.py` exists.

Sources: [Agent Skills spec](https://agentskills.io/specification)

### `link-escapes-skill`

**warning** · all targets

A link to a file outside the skill folder (`../shared/x.md`). It works in your repo and breaks when the skill is installed, copied or zipped on its own.

Sources: [Agent Skills spec](https://agentskills.io/specification)

### `absolute-path`

**warning** · all targets

Absolute or user-specific paths (`/Users/me/...`, `/home/me/...`, `C:\Users\me\...`, `file://`, links starting with `/` or `~`). They will not exist on other machines.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `windows-path`

**warning** · all targets

Backslash paths such as `scripts\helper.py`. "Always use forward slashes in file paths, even on Windows" — backslashes fail on macOS and Linux.

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `nested-reference`

**info** · Claude Code, spec

A reference file is only reachable through another reference file. Agents may preview nested files partially (`head -100`); keep references one level deep from `SKILL.md`.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `reference-no-toc`

**info** · Claude Code

A reference file linked from `SKILL.md` is over 100 lines and has no table of contents near the top.

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `unreferenced-file`

**info** · all targets

A bundled file that `SKILL.md` and its references never mention, so the agent will not know it exists. A file counts as mentioned when its path or file name appears in any Markdown or text file of the skill, when another script imports it by name, or when its folder is referenced (`schemas/`, or `"schemas"` in code). `LICENSE`, `README`, `CHANGELOG`, `__init__.py`, `requirements.txt`, `package.json` and Codex's `agents/openai.yaml` are exempt. A whole unmentioned directory, or more than three files in one directory, is reported as one finding.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## Scripts

### `script-no-shebang`

**warning** · all targets

A shell script (`.sh`, `.bash`, `.zsh`, extensionless file in `scripts/`) or an executable file without a `#!` line. Running it directly fails or picks the wrong interpreter.

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### `script-not-executable`

**warning** · all targets · 🔧 (macOS/Linux)

A script with a shebang that is not executable. SkillLint reads the mode from the git index (`100755`), so it works on Windows too, where the fix is `git update-index --chmod=+x <file>`. On macOS/Linux `--fix` runs `chmod +x`.

Sources: [Agent Skills spec](https://agentskills.io/specification)

### `script-crlf`

**error** · all targets · 🔧

A script with a shebang stored with CRLF line endings. On Linux/macOS the interpreter becomes `bash\r` and the script fails with "bad interpreter". Uses the line endings in the git index when the file is tracked.

Sources: [gitattributes](https://git-scm.com/docs/gitattributes)

### `script-windows-only`

**info** · all targets

A `.ps1`, `.bat` or `.cmd` script without a cross-platform sibling of the same name. Agents on macOS and Linux cannot run it.

Sources: [Claude best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## Layout

### `skill-nesting-depth`

**warning** · Claude Code, Gemini CLI

The skill is nested deeper than `skills/<name>/SKILL.md` (e.g. `skills/team/my-skill/SKILL.md`). Claude Code discovers `<skills-dir>/<skill-name>/SKILL.md`; Gemini CLI globs only `SKILL.md` and `*/SKILL.md`. Codex scans recursively, so the rule is silent with `--target codex`.

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills) · [Gemini CLI skill loader](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/skills/skillLoader.ts)

### `skill-location`

**info** · depends on the location

The skill lives in an agent directory that some selected targets do not scan — for example `.claude/skills` is not read by Codex or Gemini CLI, and `.agents/skills` is not read by Claude Code. See the "Project dirs" row in [How the agents differ](#how-the-agents-differ). Skills in a plain `skills/` folder (plugins, distribution repos) are not reported.

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills) · [Codex](https://learn.chatgpt.com/docs/build-skills) · [Cursor](https://cursor.com/docs/skills) · [Gemini CLI](https://geminicli.com/docs/cli/skills/) · [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills)

### `duplicate-skill-name`

**warning** · all targets

Two skills in the scanned paths share a `name`. Agents that read several locations (Cursor reads four project directories; Gemini CLI and Claude Code apply precedence) keep only one.

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills) · [Gemini CLI](https://geminicli.com/docs/cli/skills/) · [Cursor](https://cursor.com/docs/skills)

## Claude Code plugin.json

These rules apply to `.claude-plugin/plugin.json` and run when Claude Code is a target. They mirror `claude plugin validate`, plus a few install-time failures it does not report.

### `plugin-json-invalid`

**error** · Claude Code

Not valid JSON (trailing commas, comments, unquoted keys) or not a JSON object.

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-name`

**error** · Claude Code

`name` is the only required field. It must be non-empty, with no spaces, `@`, `:`, path separators or control characters.

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-name-style`

**warning** · Claude Code

The name is not kebab-case, or contains "claude"/"anthropic" as a whole word (`claude plugin validate` warns that it "reads as one of Anthropic's own").

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-name-reserved`

**error** · Claude Code

Names starting with `claude-`, `anthropic-`, `anthropics-`, `cc-plugin-`, the names `claude`, `anthropic`, `anthropics`, `claude-code`, `claude-mods`, or "official" next to claude/anthropic are reserved. (Documented for current Claude Code; older CLI versions do not check it yet.)

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-field-type`

**error** · Claude Code

`author` must be an object with `name` (a plain string is a common mistake), `homepage` must parse as a URL (otherwise the plugin fails to load), `keywords` an array of strings, `defaultEnabled` a boolean, directory listing URLs `https://`, command map entries exactly one of `source`/`content`.

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-path`

**error** · Claude Code

Every component path (`skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`, `outputStyles`, `workflows`, themes, monitors) must start with `./`, must not contain `..`, and must exist. `agents` entries must be `.md` files, `skills` entries directories, `mcpServers` paths `.json`/`.mcpb`/`.dxt`.

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-unknown-field`

**warning** · Claude Code

Unknown top-level keys are stripped at load time. Top-level `themes`/`monitors` should move under `experimental`.

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-recommended-fields`

**warning** · Claude Code

`claude plugin validate` warns when `version`, `description` or `author` is missing.

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

### `plugin-misplaced-component`

**error** · Claude Code

`skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json` and friends placed inside `.claude-plugin/`. Only the manifest belongs there; components live at the plugin root, so these are never loaded.

Sources: [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference)

## Claude Code marketplace.json

These rules apply to `.claude-plugin/marketplace.json`.

### `marketplace-json-invalid`

**error** · Claude Code

Not valid JSON or not a JSON object.

Sources: [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)

### `marketplace-required-fields`

**error** · Claude Code

`name`, `owner` (an object with a non-empty `name`) and a `plugins` array are required.

Sources: [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)

### `marketplace-name`

**error** · Claude Code

The name may only use letters, digits, `.`, `_`, `-`, must start with a letter or digit and must not contain `..`. Reserved: official Anthropic names (`claude-plugins-official`, `agent-skills`, ...) and other spellings of them, impersonations (`official-claude-plugins`, any non-ASCII name), `inline`, `builtin`, `skills-dir`, `synced`, `npm`, `pip`, `uv`, `cargo`, `github`, `gh`, and the `claudeai-` prefix. Some of these pass `claude plugin validate` and only fail when users add the marketplace.

Sources: [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)

### `marketplace-plugin-entry`

**error** · Claude Code

Each entry needs a `name` and a `source`; names follow the same character rules, must be unique and must not be reserved.

Sources: [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)

### `marketplace-source`

**error** · Claude Code

Relative sources must start with `./` (or be a bare name with `metadata.pluginRoot`), must not contain `..` or backslashes, and must exist — `claude plugin validate` passes a missing directory, but `claude plugin install` fails with "Source path does not exist". Object sources must be a known type (`github`, `url`, `git-subdir`, `npm`, `archive`, `command`) with their required fields; `sha` must be a full 40-character lowercase SHA.

Sources: [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference) · [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)

### `marketplace-consistency`

**warning** · Claude Code

For relative sources, the entry `name` should equal the plugin's own `plugin.json` name (otherwise installing by the manifest name fails with "not found in marketplace"), and the entry `version` should not disagree with `plugin.json` (plugin.json wins).

Sources: [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces) · [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)

### `marketplace-unknown-field`

**warning** · Claude Code

Unknown keys at the top level, under `metadata`, or in an entry are ignored at load time (typos load silently). Directory listing fields (`icon`, `supportUrl`, ...) belong in `plugin.json`, not in the entry.

Sources: [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)

### `marketplace-recommended-fields`

**warning** · Claude Code

No `description` (validate warns), or an empty `plugins` array.

Sources: [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)
