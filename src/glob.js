// Minimal glob matching for ignore patterns (gitignore-like semantics).
//   *   matches anything except "/"
//   **  matches any number of path segments
//   ?   matches one character except "/"
// A pattern without "/" matches a file or directory name at any depth.
// A pattern matches a directory and everything inside it.

export function globToRegExp(pattern) {
  let p = pattern.trim().replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  let anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  if (p.endsWith('/')) p = p.slice(0, -1);
  if (!p.includes('/')) anchored = false;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const slashAfter = p[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const prefix = anchored || p.startsWith('**') ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${re}(?:/.*)?$`);
}

export function makeMatcher(patterns) {
  const regs = (patterns || []).filter(Boolean).map(globToRegExp);
  return (relPath) => {
    const p = relPath.replace(/\\/g, '/');
    return regs.some((r) => r.test(p));
  };
}
