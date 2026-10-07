// Split a SKILL.md file into frontmatter and body, keeping line numbers.

/**
 * @param {string} input raw file contents
 * @returns {{
 *   bom: boolean, crlf: boolean, hasFrontmatter: boolean, unterminated: boolean,
 *   raw: string, startLine: number, endLine: number,
 *   body: string, bodyStartLine: number,
 *   openDelimiter: string, closeDelimiter: string, lateDelimiterLine: number
 * }}
 * Line numbers are 1-based and refer to the original file.
 */
export function splitFrontmatter(input) {
  let text = input;
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const crlf = /\r\n/.test(text);
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const result = {
    bom,
    crlf,
    hasFrontmatter: false,
    unterminated: false,
    raw: '',
    startLine: 0,
    endLine: 0,
    body: lines.join('\n'),
    bodyStartLine: 1,
    openDelimiter: '',
    closeDelimiter: '',
    lateDelimiterLine: 0,
  };
  if (lines[0].trimEnd() !== '---') {
    // Frontmatter that does not start on line 1 is ignored by every loader.
    for (let i = 1; i < Math.min(lines.length, 15); i++) {
      if (lines[i].trimEnd() === '---') {
        result.lateDelimiterLine = i + 1;
        break;
      }
    }
    return result;
  }
  result.hasFrontmatter = true;
  result.openDelimiter = lines[0];
  result.startLine = 1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t === '---' || t === '...') {
      result.endLine = i + 1;
      result.closeDelimiter = lines[i];
      result.raw = lines.slice(1, i).join('\n');
      result.body = lines.slice(i + 1).join('\n');
      result.bodyStartLine = i + 2;
      return result;
    }
  }
  result.unterminated = true;
  result.raw = lines.slice(1).join('\n');
  result.body = '';
  result.bodyStartLine = lines.length + 1;
  return result;
}
