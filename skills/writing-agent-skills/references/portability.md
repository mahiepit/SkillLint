# Skill portability reference

## Contents

- Frontmatter fields by agent
- Limits
- Discovery locations
- Claude Code-only body syntax

## Frontmatter fields by agent

| Field | Spec | Claude Code | Codex | Cursor | Gemini CLI | Copilot |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `name` | required | optional (defaults to folder) | required | required, must match folder | required | required |
| `description` | required | recommended | required | required | required | required |
| `license`, `compatibility`, `metadata` | yes | accepted | ignored | `metadata` | ignored | `license` |
| `allowed-tools` | experimental (string) | string or list | ignored | ignored | ignored | yes |
| `disable-model-invocation`, `paths` | no | yes | no | yes | no | no |
| `when_to_use`, `argument-hint`, `arguments`, `user-invocable`, `model`, `effort`, `context`, `agent`, `hooks`, `shell` | no | yes | no | no | no | no |
| `icon`, `color` | no | no | no | yes | no | no |

Fields outside the spec are ignored by the other agents, and `skills-ref validate` plus Claude skill uploads reject them. Codex keeps its UI metadata in `agents/openai.yaml` next to `SKILL.md` instead.

## Limits

- `name`: 1-64 characters (Codex allows 100), `a-z0-9-`, no leading, trailing or double hyphens, must not contain "claude" or "anthropic" for Claude uploads.
- `description`: 1-1024 characters; Codex's loader rejects more than 500; Claude Code truncates `description` + `when_to_use` at 1536 in its listing.
- `compatibility`: 1-500 characters.
- Body: under 500 lines and about 5000 tokens.

## Discovery locations

| Directory | Read by |
|---|---|
| `.claude/skills/` | Claude Code, Cursor, Copilot |
| `.agents/skills/` | Codex, Cursor, Gemini CLI, Copilot |
| `.cursor/skills/` | Cursor |
| `.gemini/skills/` | Gemini CLI |
| `.github/skills/` | Copilot |
| `.codex/skills/` | Cursor (legacy Codex location) |

## Claude Code-only body syntax

Claude Code substitutes `$ARGUMENTS`, `$0`/`$1`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}` and `${CLAUDE_PLUGIN_ROOT}`, and runs `` !`command` `` lines before sending the skill. Other agents show these to the model as literal text, so a portable skill describes its inputs in words and uses paths relative to the skill root instead.
