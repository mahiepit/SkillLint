// A small, dependency-free YAML parser for SKILL.md frontmatter.
//
// It supports the subset of YAML that skill frontmatter actually uses:
// block mappings and sequences, plain / single-quoted / double-quoted
// scalars (including multi-line ones), literal (|) and folded (>) block
// scalars with chomping indicators, flow collections ([a, b] and {a: b}),
// comments, and the YAML 1.2 core schema for null / bool / numbers.
//
// It is deliberately strict where real YAML parsers (PyYAML, js-yaml) are
// strict, so that frontmatter that would break an agent's loader is reported
// as an error here too (for example `description: Use when: ...`).
// It also records "gotchas": constructs that parse, but differently from
// what the author probably meant (a ` #` that silently truncates a value,
// YAML 1.1 booleans like `yes`/`no`, anchors and tags).

export class YamlError extends Error {
  constructor(message, line, column) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

const YAML11_BOOLEANS = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$/;

/**
 * Parse a YAML document.
 * @param {string} src
 * @param {{lineOffset?: number}} [opts] lineOffset is added to reported line numbers (0-based offset).
 * @returns {{value: any, error: YamlError|null, warnings: Array<{line:number,column:number,message:string}>, locations: Map<string,{line:number,column:number}>}}
 */
export function parseYaml(src, opts = {}) {
  const lineOffset = opts.lineOffset || 0;
  const p = new Parser(src, lineOffset);
  try {
    const value = p.parseDocument();
    return { value, error: null, warnings: p.warnings, locations: p.locations };
  } catch (err) {
    if (err instanceof YamlError) {
      return { value: undefined, error: err, warnings: p.warnings, locations: p.locations };
    }
    throw err;
  }
}

class Parser {
  constructor(src, lineOffset) {
    this.lines = src.replace(/\r\n?/g, '\n').split('\n');
    this.i = 0;
    this.lineOffset = lineOffset;
    this.warnings = [];
    this.locations = new Map();
  }

  lineNo(i = this.i) {
    return i + 1 + this.lineOffset;
  }

  fail(message, i = this.i, column = 1) {
    throw new YamlError(message, this.lineNo(i), column);
  }

  warn(message, i = this.i, column = 1) {
    this.warnings.push({ line: this.lineNo(i), column, message });
  }

  indentOf(text) {
    const m = /^[ \t]*/.exec(text)[0];
    return m.length;
  }

  isBlank(text) {
    return /^\s*(#.*)?$/.test(text);
  }

  checkTabs(i) {
    const text = this.lines[i];
    const lead = /^[ \t]*/.exec(text)[0];
    if (lead.includes('\t') && text.trim() !== '') {
      this.fail('tabs are not allowed for indentation in YAML; use spaces', i, lead.indexOf('\t') + 1);
    }
  }

  skipBlank() {
    while (this.i < this.lines.length && this.isBlank(this.lines[this.i])) this.i++;
  }

  parseDocument() {
    this.skipBlank();
    if (this.i >= this.lines.length) return null;
    this.checkTabs(this.i);
    const text = this.lines[this.i];
    const ind = this.indentOf(text);
    const content = text.slice(ind);
    let value;
    if (isSeqItem(content)) value = this.parseSeq(ind, '');
    else if (splitKey(content)) value = this.parseMap(ind, '');
    else {
      value = this.parseValue(content, -1, ind + 1, '');
    }
    this.skipBlank();
    if (this.i < this.lines.length) {
      const t = this.lines[this.i];
      this.fail(`unexpected content (check indentation): "${t.trim().slice(0, 40)}"`, this.i, this.indentOf(t) + 1);
    }
    return value;
  }

  parseMap(ind, path) {
    const obj = {};
    while (true) {
      this.skipBlank();
      if (this.i >= this.lines.length) break;
      this.checkTabs(this.i);
      const text = this.lines[this.i];
      const cur = this.indentOf(text);
      if (cur < ind) break;
      if (cur > ind) this.fail('bad indentation of a mapping entry', this.i, cur + 1);
      const content = text.slice(ind);
      if (isSeqItem(content)) {
        this.fail('a sequence item ("- ") cannot appear here; check the indentation', this.i, cur + 1);
      }
      const kv = splitKey(content);
      if (!kv) {
        this.fail(`could not find expected ':' after key (got "${content.trim().slice(0, 40)}")`, this.i, cur + 1);
      }
      if (Object.prototype.hasOwnProperty.call(obj, kv.key)) {
        this.fail(`duplicate key "${kv.key}"`, this.i, cur + 1);
      }
      const keyPath = path ? `${path}.${kv.key}` : kv.key;
      this.locations.set(keyPath, { line: this.lineNo(), column: cur + 1 });
      const valueColumn = ind + kv.valueOffset + 1;
      obj[kv.key] = this.parseValue(kv.rest, ind, valueColumn, keyPath);
    }
    return obj;
  }

  parseSeq(ind, path) {
    const arr = [];
    while (true) {
      this.skipBlank();
      if (this.i >= this.lines.length) break;
      this.checkTabs(this.i);
      const text = this.lines[this.i];
      const cur = this.indentOf(text);
      if (cur < ind) break;
      if (cur > ind) this.fail('bad indentation of a sequence entry', this.i, cur + 1);
      const content = text.slice(ind);
      if (!isSeqItem(content)) break;
      const after = content.slice(1);
      const spaces = /^ */.exec(after)[0].length;
      const itemCol = ind + 1 + spaces;
      const rest = after.slice(spaces);
      const itemPath = `${path}[${arr.length}]`;
      if (rest === '' || rest.startsWith('#')) {
        this.i++;
        this.skipBlank();
        if (this.i < this.lines.length && this.indentOf(this.lines[this.i]) > ind) {
          arr.push(this.parseNode(this.indentOf(this.lines[this.i]), itemPath));
        } else {
          arr.push(null);
        }
      } else if (isSeqItem(rest) || splitKey(rest)) {
        // Compact nested collection: rewrite "- key: v" as "  key: v" and parse in place.
        this.lines[this.i] = ' '.repeat(itemCol) + rest;
        arr.push(this.parseNode(itemCol, itemPath));
      } else {
        arr.push(this.parseValue(rest, ind, itemCol + 1, itemPath));
      }
    }
    return arr;
  }

  parseNode(ind, path) {
    this.skipBlank();
    const content = this.lines[this.i].slice(ind);
    if (isSeqItem(content)) return this.parseSeq(ind, path);
    if (splitKey(content)) return this.parseMap(ind, path);
    return this.parseValue(content, ind - 1, ind + 1, path);
  }

  // Parse the value that starts at `rest` on line this.i. `ind` is the indentation
  // of the owning key (continuation lines must be indented more than this).
  parseValue(rest, ind, column, path) {
    const startLine = this.i;
    if (rest === '' || /^#/.test(rest)) {
      this.i++;
      this.skipBlank();
      if (this.i < this.lines.length) {
        this.checkTabs(this.i);
        const next = this.lines[this.i];
        const nind = this.indentOf(next);
        if (nind > ind) return this.parseNode(nind, path);
        if (nind === ind && ind >= 0 && isSeqItem(next.slice(nind))) return this.parseSeq(nind, path);
      }
      return null;
    }
    const c = rest[0];
    if (c === '|' || c === '>') return this.parseBlockScalar(rest, ind, column);
    if (c === '"') return this.parseQuoted(rest, ind, column, '"');
    if (c === "'") return this.parseQuoted(rest, ind, column, "'");
    if (c === '[' || c === '{') return this.parseFlow(rest, ind, column);
    if (c === '&' || c === '*' || c === '!') {
      this.warn(`YAML ${c === '&' ? 'anchors' : c === '*' ? 'aliases' : 'tags'} are not portable across skill loaders; use a plain value`, startLine, column);
      if (c === '*') {
        this.i++;
        return rest.trim();
      }
      const m = /^\S+\s*(.*)$/.exec(rest);
      return this.parseValue(m[1], ind, column, path);
    }
    if (c === '@' || c === '`' || c === '%') {
      this.fail(`a plain value cannot start with "${c}"; wrap the value in quotes`, startLine, column);
    }
    if ((c === '-' || c === '?' || c === ':') && /^[-?:](\s|$)/.test(rest)) {
      this.fail(`a plain value cannot start with "${c} "; wrap the value in quotes`, startLine, column);
    }
    return this.parsePlain(rest, ind, column);
  }

  parsePlain(rest, ind, column) {
    const parts = [];
    const first = this.cleanPlainLine(rest, this.i, column);
    parts.push(first.text);
    let ended = first.comment;
    this.i++;
    let pendingBlank = 0;
    while (!ended && this.i < this.lines.length) {
      const text = this.lines[this.i];
      if (text.trim() === '') {
        pendingBlank++;
        this.i++;
        continue;
      }
      const nind = this.indentOf(text);
      if (nind <= ind || /^\s*#/.test(text)) break;
      this.checkTabs(this.i);
      const line = this.cleanPlainLine(text.slice(nind), this.i, nind + 1);
      if (pendingBlank) parts.push('\n'.repeat(pendingBlank));
      else parts.push(' ');
      pendingBlank = 0;
      parts.push(line.text);
      ended = line.comment;
      this.i++;
    }
    const joined = parts.join('');
    if (parts.length === 1) return this.resolvePlain(joined, column);
    return joined;
  }

  // Validates one line of a plain scalar and strips a trailing comment.
  cleanPlainLine(text, i, column) {
    let comment = false;
    let out = text;
    const hash = out.search(/\s#/);
    if (hash !== -1) {
      const dropped = out.slice(hash).trim();
      out = out.slice(0, hash);
      comment = true;
      if (dropped.length > 1) {
        this.warn(`text after " #" is a YAML comment and is silently dropped ("${dropped.slice(0, 30)}"); quote the value to keep it`, i, column + hash + 1);
      }
    }
    out = out.replace(/\s+$/, '');
    const colon = out.search(/:(\s|$)/);
    if (colon !== -1) {
      this.fail('mapping values are not allowed here: a plain value contains ": " (colon + space) or ends with ":"; wrap the whole value in quotes', i, column + colon);
    }
    return { text: out, comment };
  }

  resolvePlain(s, column) {
    const v = resolveScalar(s);
    if (typeof v === 'string' && YAML11_BOOLEANS.test(s)) {
      this.warn(`"${s}" is a boolean in YAML 1.1 parsers (PyYAML) but a string in YAML 1.2; quote it or use true/false`, this.i - 1, column);
    }
    return v;
  }

  parseQuoted(rest, ind, column, q) {
    const startLine = this.i;
    let lineText = rest;
    let pos = 1;
    let out = '';
    let lineCol = column;
    let escapedNewline = false;
    while (true) {
      if (pos >= lineText.length) {
        // Multi-line quoted scalar: fold the line break.
        this.i++;
        if (this.i >= this.lines.length) this.fail(`unterminated ${q === '"' ? 'double' : 'single'}-quoted string`, startLine, column);
        let blank = 0;
        while (this.i < this.lines.length && this.lines[this.i].trim() === '') {
          blank++;
          this.i++;
        }
        if (this.i >= this.lines.length) this.fail(`unterminated ${q === '"' ? 'double' : 'single'}-quoted string`, startLine, column);
        if (escapedNewline) escapedNewline = false;
        else {
          out = out.replace(/[ \t]+$/, '');
          out += blank ? '\n'.repeat(blank) : ' ';
        }
        const t = this.lines[this.i];
        const nind = this.indentOf(t);
        lineText = t.slice(nind);
        lineCol = nind + 1;
        pos = 0;
        continue;
      }
      const ch = lineText[pos];
      if (q === "'" && ch === "'") {
        if (lineText[pos + 1] === "'") {
          out += "'";
          pos += 2;
          continue;
        }
        pos++;
        break;
      }
      if (q === '"' && ch === '"') {
        pos++;
        break;
      }
      if (q === '"' && ch === '\\') {
        const e = lineText[pos + 1];
        if (e === undefined) {
          // Escaped line break: join without a space.
          escapedNewline = true;
          pos++;
          continue;
        }
        const simple = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ' };
        if (e in simple) {
          out += simple[e];
          pos += 2;
          continue;
        }
        const hexLen = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0;
        if (hexLen) {
          const hex = lineText.slice(pos + 2, pos + 2 + hexLen);
          if (!new RegExp(`^[0-9a-fA-F]{${hexLen}}$`).test(hex)) this.fail(`invalid escape sequence "\\${e}${hex}"`, this.i, lineCol + pos);
          out += String.fromCodePoint(parseInt(hex, 16));
          pos += 2 + hexLen;
          continue;
        }
        this.fail(`unknown escape sequence "\\${e}" in a double-quoted string (use "\\\\" for a backslash or single quotes)`, this.i, lineCol + pos);
      }
      out += ch;
      pos++;
    }
    const after = lineText.slice(pos);
    if (!/^\s*(#.*)?$/.test(after)) {
      this.fail(`unexpected text after the closing quote: "${after.trim().slice(0, 30)}"`, this.i, lineCol + pos);
    }
    this.i++;
    return out;
  }

  parseBlockScalar(rest, ind, column) {
    const m = /^([|>])([+-]?)([1-9]?)([+-]?)\s*(#.*)?$/.exec(rest);
    if (!m) this.fail(`invalid block scalar header "${rest.trim()}"`, this.i, column);
    const style = m[1];
    const chomp = m[2] || m[4] || '';
    const explicit = m[3] ? Number(m[3]) : 0;
    this.i++;
    const base = Math.max(ind, 0);
    let contentIndent = explicit ? base + explicit : -1;
    const raw = [];
    while (this.i < this.lines.length) {
      const t = this.lines[this.i];
      if (t.trim() === '') {
        raw.push('');
        this.i++;
        continue;
      }
      const nind = this.indentOf(t);
      if (contentIndent === -1) {
        if (nind <= ind) break;
        contentIndent = nind;
      }
      if (nind < contentIndent) break;
      this.checkTabs(this.i);
      raw.push(t.slice(contentIndent));
      this.i++;
    }
    // Trailing blank lines are subject to chomping; give them back as "consumed".
    let trailing = 0;
    while (raw.length && raw[raw.length - 1] === '') {
      raw.pop();
      trailing++;
    }
    let body;
    if (style === '|') {
      body = raw.join('\n');
    } else {
      body = '';
      for (let k = 0; k < raw.length; k++) {
        const line = raw[k];
        if (k === 0) {
          body = line;
          continue;
        }
        const prev = raw[k - 1];
        const moreIndented = /^\s/.test(line) || /^\s/.test(prev);
        if (line === '') body += '\n';
        else if (prev === '' || moreIndented) body += (prev === '' ? '' : '\n') + line;
        else body += ' ' + line;
      }
    }
    if (raw.length === 0) return '';
    if (chomp === '-') return body;
    if (chomp === '+') return body + '\n' + '\n'.repeat(trailing);
    return body + '\n';
  }

  parseFlow(rest, ind, column) {
    const startLine = this.i;
    // Gather text until brackets balance.
    let text = rest;
    let depth = 0;
    let inQ = null;
    let done = false;
    let consumedLines = 0;
    const scan = (s) => {
      for (let k = 0; k < s.length; k++) {
        const ch = s[k];
        if (inQ) {
          if (ch === '\\' && inQ === '"') {
            k++;
            continue;
          }
          if (ch === inQ) inQ = null;
          continue;
        }
        if (ch === '"' || ch === "'") inQ = ch;
        else if (ch === '#' && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k);
        else if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') {
          depth--;
          if (depth === 0) {
            done = true;
            const after = s.slice(k + 1);
            if (!/^\s*(#.*)?$/.test(after)) this.fail(`unexpected text after a flow collection: "${after.trim().slice(0, 30)}"`, this.i, column + k + 1);
            return s.slice(0, k + 1);
          }
        }
      }
      return s;
    };
    let acc = scan(text);
    while (!done) {
      this.i++;
      consumedLines++;
      if (this.i >= this.lines.length) this.fail('unterminated flow collection (missing "]" or "}")', startLine, column);
      acc += ' ' + scan(this.lines[this.i].trim());
    }
    this.i++;
    const fp = new FlowParser(acc, (msg, off) => this.fail(msg, startLine, column + (consumedLines ? 0 : off)));
    const value = fp.parse();
    return value;
  }
}

class FlowParser {
  constructor(s, fail) {
    this.s = s;
    this.p = 0;
    this.fail = fail;
  }
  ws() {
    while (this.p < this.s.length && /\s/.test(this.s[this.p])) this.p++;
  }
  parse() {
    this.ws();
    const v = this.value();
    this.ws();
    if (this.p < this.s.length) this.fail(`unexpected "${this.s.slice(this.p, this.p + 10)}" in flow collection`, this.p);
    return v;
  }
  value() {
    this.ws();
    const ch = this.s[this.p];
    if (ch === '[') return this.seq();
    if (ch === '{') return this.map();
    if (ch === '"' || ch === "'") return this.quoted(ch);
    return this.plain();
  }
  seq() {
    this.p++;
    const arr = [];
    this.ws();
    if (this.s[this.p] === ']') {
      this.p++;
      return arr;
    }
    while (true) {
      arr.push(this.value());
      this.ws();
      const ch = this.s[this.p];
      if (ch === ',') {
        this.p++;
        this.ws();
        if (this.s[this.p] === ']') {
          this.p++;
          return arr;
        }
        continue;
      }
      if (ch === ']') {
        this.p++;
        return arr;
      }
      this.fail('expected "," or "]" in flow sequence', this.p);
    }
  }
  map() {
    this.p++;
    const obj = {};
    this.ws();
    if (this.s[this.p] === '}') {
      this.p++;
      return obj;
    }
    while (true) {
      this.ws();
      const k = this.s[this.p] === '"' || this.s[this.p] === "'" ? this.quoted(this.s[this.p]) : this.plain(true);
      this.ws();
      let v = null;
      if (this.s[this.p] === ':') {
        this.p++;
        v = this.value();
      }
      obj[String(k)] = v;
      this.ws();
      const ch = this.s[this.p];
      if (ch === ',') {
        this.p++;
        this.ws();
        if (this.s[this.p] === '}') {
          this.p++;
          return obj;
        }
        continue;
      }
      if (ch === '}') {
        this.p++;
        return obj;
      }
      this.fail('expected "," or "}" in flow mapping', this.p);
    }
  }
  quoted(q) {
    this.p++;
    let out = '';
    while (this.p < this.s.length) {
      const ch = this.s[this.p];
      if (q === "'" && ch === "'") {
        if (this.s[this.p + 1] === "'") {
          out += "'";
          this.p += 2;
          continue;
        }
        this.p++;
        return out;
      }
      if (q === '"' && ch === '\\') {
        const e = this.s[this.p + 1];
        const map = { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', r: '\r', '0': '\0' };
        out += map[e] ?? e;
        this.p += 2;
        continue;
      }
      if (q === '"' && ch === '"') {
        this.p++;
        return out;
      }
      out += ch;
      this.p++;
    }
    this.fail('unterminated quoted string in flow collection', this.p);
  }
  plain(isKey = false) {
    const start = this.p;
    while (this.p < this.s.length) {
      const ch = this.s[this.p];
      if (ch === ',' || ch === ']' || ch === '}' || ch === '[' || ch === '{') break;
      if (ch === ':' && (isKey || /[\s,\]}]/.test(this.s[this.p + 1] ?? ' '))) break;
      this.p++;
    }
    const raw = this.s.slice(start, this.p).trim();
    return isKey ? raw : resolveScalar(raw);
  }
}

function isSeqItem(content) {
  return content === '-' || content.startsWith('- ') || content.startsWith('-\t');
}

// Split "key: rest" (plain or quoted key). Returns null if the line is not a mapping entry.
export function splitKey(content) {
  if (!content || content[0] === '#' || isSeqItem(content)) return null;
  const c = content[0];
  if (c === '"' || c === "'") {
    let k = 1;
    let key = '';
    while (k < content.length) {
      if (content[k] === c) {
        if (c === "'" && content[k + 1] === "'") {
          key += "'";
          k += 2;
          continue;
        }
        break;
      }
      if (c === '"' && content[k] === '\\') {
        key += content[k + 1] ?? '';
        k += 2;
        continue;
      }
      key += content[k];
      k++;
    }
    if (k >= content.length) return null;
    const after = content.slice(k + 1);
    const m = /^\s*:(\s+|$)/.exec(after);
    if (!m) return null;
    return { key, rest: after.slice(m[0].length), valueOffset: k + 1 + m[0].length };
  }
  if ('[{|>&*!%@`'.includes(c)) return null;
  const m = /^([^#]*?)\s*:(\s+|$)/.exec(content);
  if (!m) return null;
  const key = m[1];
  if (!key) return null;
  if (/\s#/.test(key)) return null;
  return { key, rest: content.slice(m[0].length), valueOffset: m[0].length };
}

export function resolveScalar(s) {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (/^[-+]?(0|[1-9][0-9]*)$/.test(s)) return Number(s);
  if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8);
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(s)) return Number(s);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(s)) return NaN;
  return s;
}
