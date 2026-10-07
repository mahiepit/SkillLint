---
name: writing-agent-skills
description: Writes, reviews and lints Agent Skills (SKILL.md folders) so they load and trigger correctly in Claude Code, OpenAI Codex, Cursor, Gemini CLI and GitHub Copilot, using the SkillLint CLI. Use when creating or editing a SKILL.md, when a skill does not load or trigger, or before publishing skills or a Claude Code plugin.
license: MIT
compatibility: Linting needs Node.js 18+ (npx downloads SkillLint from GitHub on first use)
metadata:
  author: mahiepit
  version: "1.0.0"
---

# Writing and linting Agent Skills

A skill is a folder with a `SKILL.md` file: YAML frontmatter (`name`, `description`) followed by Markdown instructions. Agents read only `name` and `description` at startup and load the body when the description matches the task, so the description decides whether the skill is ever used.

## Workflow

Copy this checklist and tick it off:

```
- [ ] 1. Pick the folder name and location
- [ ] 2. Write the frontmatter
- [ ] 3. Write the body and bundled files
- [ ] 4. Run SkillLint and fix every error
- [ ] 5. Re-run until it reports no errors
```

### 1. Folder name and location

- The folder name **is** the skill name: lowercase `a-z`, digits and single hyphens, at most 64 characters, e.g. `processing-invoices`. No uppercase, underscores or spaces.
- Where agents look for project skills:
  - `.claude/skills/<name>/` — Claude Code (also read by Cursor and Copilot)
  - `.agents/skills/<name>/` — Codex, Cursor, Gemini CLI and Copilot
  - `skills/<name>/` — inside a Claude Code plugin
- Keep exactly one level: `skills/<name>/SKILL.md`. Claude Code and Gemini CLI do not find deeper nesting.

### 2. Frontmatter

Start from [assets/SKILL.template.md](assets/SKILL.template.md). Rules that break loading:

- The file must be named exactly `SKILL.md` and start with `---` on line 1 (no BOM, nothing before it).
- `name` must equal the folder name.
- `description` is required, at most 1024 characters, and **under 500 characters** if the skill must also load in Codex.
- Quote the description if it contains `: ` or ` #` — otherwise YAML fails or silently cuts the text. When in doubt, use double quotes.
- Write the description in the third person and include both *what* and *when*: "Extracts tables from PDF files. Use when the user mentions PDFs, forms or invoices." Never "I can help you ...".
- For portable skills use only the spec fields: `name`, `description`, `license`, `compatibility`, `metadata` (string values; quote versions such as `"1.0"`), `allowed-tools` (a space-separated string). See [references/portability.md](references/portability.md) for which agent supports which extra field.

### 3. Body and bundled files

- Keep `SKILL.md` under 500 lines (about 5000 tokens). Move long reference material into `references/`, scripts into `scripts/`, templates into `assets/`.
- Link every bundled file from `SKILL.md` with a relative path and forward slashes, and say when to use it. Files that are never mentioned are invisible to the agent.
- Keep references one level deep: link reference files from `SKILL.md`, not from other reference files.
- Scripts need a shebang (`#!/usr/bin/env python3`), LF line endings and the executable bit (`git update-index --chmod=+x <file>` on Windows).
- No absolute or user-specific paths (`C:\Users\...`, `/Users/...`), no backslash paths, and no wording that goes stale ("until next month", "the new API since last year").

### 4. Lint

Run from the repository root (Node.js 18+):

```bash
npx --yes github:mahiepit/SkillLint .
```

Lint one skill, or check only the agents you ship to:

```bash
npx --yes github:mahiepit/SkillLint .claude/skills/my-skill
npx --yes github:mahiepit/SkillLint --target claude,codex .
```

In Claude Code with the SkillLint plugin installed, the same CLI is also on the Bash PATH as `skilllint.js`.

Reading the output: each line is `line:column  severity  message  rule-id`, followed by a `fix:` hint.

- **error** — at least one agent will not load the skill, or loads it wrong. Fix all of them.
- **warning** — it loads, but triggers poorly or breaks for some agents. Fix unless the warning is about an agent you do not target (then pass `--target`).
- **info** — housekeeping (unreferenced files, CRLF, missing table of contents).

`--fix` applies the safe fixes (BOM, CRLF in scripts, trailing whitespace, name casing when it matches the folder). Every rule is explained at https://github.com/mahiepit/SkillLint/blob/main/docs/RULES.md.

### 5. Iterate

Fix, re-run, and repeat until the summary says `0 errors`. Then test the skill for real: ask the agent a question that should trigger it and check that it does; if not, add the user's words to the description.

## Publishing

- Add the GitHub Action so every pull request is linted: `uses: mahiepit/SkillLint@v1`.
- For a Claude Code plugin, SkillLint also checks `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (names, `./` paths, sources).
