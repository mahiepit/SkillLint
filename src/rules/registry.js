// Metadata for every rule: id, default severity, the agents it matters for,
// and the documentation it is based on. docs/RULES.md documents each one.

const ALL = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'spec'];
const NON_CLAUDE = ['codex', 'cursor', 'gemini', 'copilot', 'spec'];
const NEEDS_FRONTMATTER = ['codex', 'cursor', 'gemini', 'copilot', 'spec'];

export const SRC = {
  spec: 'https://agentskills.io/specification',
  skillsRef: 'https://github.com/agentskills/agentskills/tree/main/skills-ref',
  claudeSkills: 'https://code.claude.com/docs/en/skills',
  claudeBest: 'https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices',
  codex: 'https://learn.chatgpt.com/docs/build-skills',
  codexLoader: 'https://github.com/openai/codex/blob/rust-v0.65.0/codex-rs/core/src/skills/loader.rs',
  cursor: 'https://cursor.com/docs/skills',
  gemini: 'https://geminicli.com/docs/cli/skills/',
  geminiCreate: 'https://geminicli.com/docs/cli/creating-skills/',
  geminiLoader: 'https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/skills/skillLoader.ts',
  copilot: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills',
  plugin: 'https://code.claude.com/docs/en/plugins-reference',
  marketplace: 'https://code.claude.com/docs/en/plugins/marketplace-reference',
  marketplaceCreate: 'https://code.claude.com/docs/en/plugin-marketplaces',
  yaml: 'https://yaml.org/spec/1.2.2/',
  gitattributes: 'https://git-scm.com/docs/gitattributes',
};

const r = (id, severity, targets, summary, sources, extra = {}) => ({ id, severity, targets, summary, sources, fixable: false, category: 'skill', ...extra });

export const RULES = [
  // File and frontmatter structure
  r('skill-md-filename', 'error', ALL, 'The skill file must be named exactly SKILL.md (case-sensitive).', [SRC.spec, SRC.copilot]),
  r('frontmatter-missing', 'error', ALL, 'SKILL.md must start with YAML frontmatter on line 1.', [SRC.spec, SRC.claudeSkills, SRC.codex]),
  r('frontmatter-unterminated', 'error', ALL, 'The frontmatter has no closing --- line.', [SRC.spec]),
  r('frontmatter-invalid-yaml', 'error', ALL, 'The frontmatter is not valid YAML, or is not a key/value mapping.', [SRC.spec, SRC.yaml]),
  r('frontmatter-delimiter', 'error', ['gemini', 'spec'], 'The --- delimiter lines must not carry trailing spaces or other text.', [SRC.geminiLoader], { fixable: true }),
  r('file-bom', 'error', ALL, 'SKILL.md must not start with a UTF-8 byte order mark (BOM).', [SRC.geminiLoader, SRC.spec], { fixable: true }),
  r('yaml-gotcha', 'warning', ALL, 'YAML that parses, but not the way it reads (" #" comments, yes/no booleans, anchors).', [SRC.yaml]),
  r('trailing-whitespace', 'info', ALL, 'Trailing whitespace in the frontmatter.', [SRC.yaml], { fixable: true }),
  r('crlf-line-endings', 'info', ALL, 'SKILL.md uses CRLF line endings; LF is the portable choice.', [SRC.gitattributes], { fixable: true }),

  // name
  r('name-missing', 'error', NEEDS_FRONTMATTER, 'The required `name` field is missing.', [SRC.spec, SRC.codex, SRC.cursor, SRC.geminiCreate, SRC.copilot]),
  r('name-format', 'error', ALL, '`name` may only contain a-z, 0-9 and single hyphens, and must not start or end with a hyphen.', [SRC.spec, SRC.claudeBest, SRC.cursor, SRC.copilot], { fixable: true }),
  r('name-too-long', 'error', ['spec', 'claude', 'cursor', 'copilot'], '`name` must be at most 64 characters (Codex: 100).', [SRC.spec, SRC.claudeBest, SRC.codexLoader]),
  r('name-dir-mismatch', 'error', ['spec', 'cursor', 'gemini', 'copilot'], '`name` must match the name of the skill directory.', [SRC.spec, SRC.cursor, SRC.geminiCreate, SRC.skillsRef]),
  r('name-reserved-word', 'warning', ['claude'], '`name` must not contain the reserved words "anthropic" or "claude".', [SRC.claudeBest]),
  r('name-vague', 'warning', ALL, '`name` is too generic (helper, utils, tools, data, ...).', [SRC.claudeBest]),

  // description
  r('description-missing', 'error', NEEDS_FRONTMATTER, 'The required `description` field is missing or empty.', [SRC.spec, SRC.codex, SRC.cursor, SRC.geminiCreate, SRC.copilot]),
  r('description-too-long', 'error', ['spec', 'claude'], '`description` must be at most 1024 characters.', [SRC.spec, SRC.claudeBest]),
  r('description-too-long-codex', 'warning', ['codex'], '`description` over 500 characters is rejected by the Codex skill loader.', [SRC.codexLoader]),
  r('description-too-short', 'warning', ALL, '`description` is too short for an agent to know when to use the skill.', [SRC.spec, SRC.claudeBest]),
  r('description-no-trigger', 'warning', ALL, '`description` should say when to use the skill ("Use when ...").', [SRC.spec, SRC.claudeBest, SRC.codex, SRC.geminiCreate]),
  r('description-person', 'warning', ALL, '`description` should be written in the third person ("Extracts ...", not "I can ..." / "You can ...").', [SRC.claudeBest]),
  r('description-xml-tags', 'error', ['claude'], '`description` must not contain XML tags.', [SRC.claudeBest]),
  r('description-listing-budget', 'warning', ['claude'], '`description` + `when_to_use` over 1536 characters is truncated in the Claude Code skill listing.', [SRC.claudeSkills]),

  // other fields
  r('field-type', 'error', ALL, 'A frontmatter field has the wrong type or value.', [SRC.spec, SRC.claudeSkills]),
  r('compatibility-invalid', 'error', ['spec'], '`compatibility` must be a non-empty string of at most 500 characters.', [SRC.spec, SRC.claudeSkills]),
  r('metadata-invalid', 'warning', ['spec', 'cursor'], '`metadata` must be a mapping of string keys to string values.', [SRC.spec, SRC.cursor]),
  r('allowed-tools-format', 'warning', NON_CLAUDE, '`allowed-tools` should be a space-separated string.', [SRC.spec, SRC.claudeSkills]),
  r('license-file-missing', 'warning', ['spec'], '`license` refers to a bundled license file that does not exist.', [SRC.spec]),
  r('unknown-field', 'warning', ALL, 'A frontmatter field that no supported agent recognizes (probably a typo).', [SRC.spec, SRC.skillsRef, SRC.claudeSkills, SRC.cursor]),
  r('non-portable-field', 'warning', ALL, 'A frontmatter field that only some agents understand.', [SRC.spec, SRC.skillsRef, SRC.claudeSkills, SRC.cursor], { computedTargets: true }),

  // body
  r('body-empty', 'warning', ALL, 'The SKILL.md body (instructions) is empty.', [SRC.spec]),
  r('body-too-long', 'warning', ALL, 'The SKILL.md body is over 500 lines.', [SRC.spec, SRC.claudeBest, SRC.codex]),
  r('body-token-budget', 'warning', ['spec', 'claude'], 'The SKILL.md body is over the recommended ~5000 tokens.', [SRC.spec, SRC.claudeSkills]),
  r('agent-specific-syntax', 'warning', NON_CLAUDE, 'The body uses Claude Code-only substitutions ($ARGUMENTS, ${CLAUDE_SKILL_DIR}, !`cmd`).', [SRC.claudeSkills]),
  r('time-sensitive', 'info', ['claude'], 'The body contains time-sensitive wording ("before August 2025") that will go stale.', [SRC.claudeBest]),

  // references
  r('link-broken', 'error', ALL, 'A relative Markdown link points to a file that does not exist.', [SRC.spec, SRC.claudeBest]),
  r('path-reference-missing', 'warning', ALL, 'A referenced path such as scripts/x.py does not exist in the skill.', [SRC.spec]),
  r('link-escapes-skill', 'warning', ALL, 'A link points outside the skill directory; it breaks when the skill is installed alone.', [SRC.spec]),
  r('absolute-path', 'warning', ALL, 'An absolute or user-specific path (/Users/..., C:\\Users\\..., ~/...) that will not exist on other machines.', [SRC.spec, SRC.claudeBest]),
  r('windows-path', 'warning', ALL, 'A Windows-style path with backslashes; use forward slashes.', [SRC.claudeBest]),
  r('nested-reference', 'info', ['claude', 'spec'], 'A file is only reachable through another reference file; keep references one level deep.', [SRC.spec, SRC.claudeBest]),
  r('reference-no-toc', 'info', ['claude'], 'A reference file over 100 lines has no table of contents.', [SRC.claudeBest]),
  r('unreferenced-file', 'info', ALL, 'A bundled file is never mentioned, so the agent will not know it exists.', [SRC.spec, SRC.claudeBest]),

  // scripts
  r('script-no-shebang', 'warning', ALL, 'An executable or shell script has no #! shebang line.', [SRC.spec, SRC.claudeBest]),
  r('script-not-executable', 'warning', ALL, 'A script with a shebang is not marked executable (chmod +x).', [SRC.spec]),
  r('script-crlf', 'error', ALL, 'A script with a shebang has CRLF line endings and will fail on Linux/macOS.', [SRC.gitattributes], { fixable: true }),
  r('script-windows-only', 'info', ALL, 'A script only exists as .ps1/.bat/.cmd, which agents on macOS/Linux cannot run.', [SRC.claudeBest]),

  // layout
  r('skill-nesting-depth', 'warning', ['claude', 'gemini'], 'The skill is nested deeper than skills/<name>/SKILL.md, where some agents do not look.', [SRC.claudeSkills, SRC.geminiLoader]),
  r('skill-location', 'info', ALL, 'The skill lives in a directory that some of the targeted agents do not scan.', [SRC.claudeSkills, SRC.codex, SRC.cursor, SRC.gemini, SRC.copilot], { computedTargets: true }),
  r('duplicate-skill-name', 'warning', ALL, 'Two skills share the same name; agents that load both will shadow one.', [SRC.claudeSkills, SRC.gemini, SRC.cursor]),

  // Claude Code plugin manifest
  r('plugin-json-invalid', 'error', ['claude'], '.claude-plugin/plugin.json is not valid JSON or not an object.', [SRC.plugin], { category: 'plugin' }),
  r('plugin-name', 'error', ['claude'], 'plugin.json `name` is missing or contains forbidden characters.', [SRC.plugin], { category: 'plugin' }),
  r('plugin-name-style', 'warning', ['claude'], 'plugin.json `name` should be kebab-case and should not read as an Anthropic plugin.', [SRC.plugin], { category: 'plugin' }),
  r('plugin-name-reserved', 'error', ['claude'], 'plugin.json `name` is reserved (claude-*, anthropic-*, official ...).', [SRC.plugin], { category: 'plugin' }),
  r('plugin-field-type', 'error', ['claude'], 'A plugin.json field has the wrong type.', [SRC.plugin], { category: 'plugin' }),
  r('plugin-path', 'error', ['claude'], 'A component path must start with ./, stay inside the plugin, and exist.', [SRC.plugin], { category: 'plugin' }),
  r('plugin-unknown-field', 'warning', ['claude'], 'Unknown top-level plugin.json field (Claude Code strips it).', [SRC.plugin], { category: 'plugin' }),
  r('plugin-recommended-fields', 'warning', ['claude'], 'plugin.json is missing `version`, `description` or `author`.', [SRC.plugin], { category: 'plugin' }),
  r('plugin-misplaced-component', 'error', ['claude'], 'Component directories (skills/, commands/, ...) must be at the plugin root, not inside .claude-plugin/.', [SRC.plugin], { category: 'plugin' }),

  // Claude Code marketplace manifest
  r('marketplace-json-invalid', 'error', ['claude'], '.claude-plugin/marketplace.json is not valid JSON or not an object.', [SRC.marketplace], { category: 'plugin' }),
  r('marketplace-required-fields', 'error', ['claude'], 'marketplace.json needs `name`, `owner.name` and a `plugins` array.', [SRC.marketplace], { category: 'plugin' }),
  r('marketplace-name', 'error', ['claude'], 'The marketplace name has invalid characters or is reserved.', [SRC.marketplace], { category: 'plugin' }),
  r('marketplace-plugin-entry', 'error', ['claude'], 'A plugin entry is missing `name`/`source`, has an invalid name, or is duplicated.', [SRC.marketplace], { category: 'plugin' }),
  r('marketplace-source', 'error', ['claude'], 'A plugin `source` is malformed, escapes the marketplace, or points to a missing directory.', [SRC.marketplace, SRC.marketplaceCreate], { category: 'plugin' }),
  r('marketplace-consistency', 'warning', ['claude'], 'A plugin entry disagrees with the plugin\'s own plugin.json (name or version).', [SRC.marketplaceCreate, SRC.marketplace], { category: 'plugin' }),
  r('marketplace-unknown-field', 'warning', ['claude'], 'Unknown field in marketplace.json (Claude Code ignores it).', [SRC.marketplace], { category: 'plugin' }),
  r('marketplace-recommended-fields', 'warning', ['claude'], 'marketplace.json has no description, or lists no plugins.', [SRC.marketplace], { category: 'plugin' }),
];

export const RULE_MAP = new Map(RULES.map((rule) => [rule.id, rule]));

export const DOCS_URL = 'https://github.com/mahiepit/SkillLint/blob/main/docs/RULES.md';

export function ruleDocsUrl(id) {
  return `${DOCS_URL}#${id}`;
}
