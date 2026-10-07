// The agents SkillLint knows about, and what each of them supports.
// Every entry is based on the agent's own documentation (see docs/RULES.md).

export const AGENTS = {
  claude: {
    label: 'Claude Code',
    docs: 'https://code.claude.com/docs/en/skills',
    // Project-level skill directories this agent scans.
    projectDirs: ['.claude/skills'],
  },
  codex: {
    label: 'OpenAI Codex',
    docs: 'https://learn.chatgpt.com/docs/build-skills',
    projectDirs: ['.agents/skills'],
  },
  cursor: {
    label: 'Cursor',
    docs: 'https://cursor.com/docs/skills',
    projectDirs: ['.cursor/skills', '.agents/skills', '.claude/skills', '.codex/skills'],
  },
  gemini: {
    label: 'Gemini CLI',
    docs: 'https://geminicli.com/docs/cli/skills/',
    projectDirs: ['.gemini/skills', '.agents/skills'],
  },
  copilot: {
    label: 'GitHub Copilot',
    docs: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-skills',
    projectDirs: ['.github/skills', '.claude/skills', '.agents/skills'],
  },
  spec: {
    label: 'Agent Skills spec',
    docs: 'https://agentskills.io/specification',
    projectDirs: [],
  },
};

export const ALL_TARGETS = Object.keys(AGENTS);

// Frontmatter fields defined by the Agent Skills specification.
export const SPEC_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

// Fields outside the spec, and the agents that understand them.
export const EXTRA_FIELDS = {
  when_to_use: ['claude'],
  'argument-hint': ['claude'],
  arguments: ['claude'],
  'disable-model-invocation': ['claude', 'cursor'],
  'user-invocable': ['claude'],
  'disallowed-tools': ['claude'],
  model: ['claude'],
  effort: ['claude'],
  context: ['claude'],
  agent: ['claude'],
  background: ['claude'],
  hooks: ['claude'],
  paths: ['claude', 'cursor'],
  shell: ['claude'],
  icon: ['cursor'],
  color: ['cursor'],
};

export const KNOWN_FIELDS = [...SPEC_FIELDS, ...Object.keys(EXTRA_FIELDS)];

// Directories (relative to a repository) where agents look for project skills.
export const SKILL_ROOTS = ['.claude/skills', '.agents/skills', '.codex/skills', '.cursor/skills', '.gemini/skills', '.github/skills'];

export function parseTargets(value) {
  if (!value || value === 'all') return [...ALL_TARGETS];
  const list = (Array.isArray(value) ? value : String(value).split(','))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const aliases = { 'claude-code': 'claude', openai: 'codex', 'gemini-cli': 'gemini', 'github-copilot': 'copilot', agentskills: 'spec' };
  const out = [];
  for (const raw of list) {
    if (raw === 'all') return [...ALL_TARGETS];
    const t = aliases[raw] || raw;
    if (!AGENTS[t]) throw new Error(`Unknown target "${raw}". Valid targets: ${ALL_TARGETS.join(', ')}, all`);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function labelList(targets) {
  return targets.map((t) => AGENTS[t]?.label || t).join(', ');
}
