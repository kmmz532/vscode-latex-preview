export interface BibEntry {
  type: string;
  key: string;
  /** フィールド名は小文字。値は外側の {} / "" を外した LaTeX ソース */
  fields: Record<string, string>;
}

const MONTHS: Record<string, string> = Object.fromEntries(
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m) => [
    m.slice(0, 3).toLowerCase(),
    m,
  ])
);

/** 簡易 BibTeX パーサ。壊れたエントリは読み飛ばす */
export function parseBib(src: string): Map<string, BibEntry> {
  const entries = new Map<string, BibEntry>();
  // 標準スタイルが定義している月の略称（month = mar）
  const strings: Record<string, string> = { ...MONTHS };
  let i = 0;

  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i])) {
      i++;
    }
  };
  /** 対応する閉じ括弧まで読む（i は開き括弧の位置） */
  const readBalanced = (open: string, close: string): string => {
    let depth = 0;
    const start = i + 1;
    for (; i < src.length; i++) {
      if (src[i] === '\\') {
        i++;
        continue;
      }
      if (src[i] === open) {
        depth++;
      } else if (src[i] === close && --depth === 0) {
        return src.slice(start, i++);
      }
    }
    return src.slice(start);
  };
  const readValue = (): string => {
    let out = '';
    for (;;) {
      skipWs();
      const c = src[i];
      if (c === '{') {
        out += readBalanced('{', '}');
      } else if (c === '"') {
        const end = src.indexOf('"', i + 1);
        out += src.slice(i + 1, end < 0 ? src.length : end);
        i = end < 0 ? src.length : end + 1;
      } else {
        const m = /^[^\s,#}]+/.exec(src.slice(i));
        const word = m ? m[0] : '';
        i += word.length;
        // @string で定義された略称か数値
        out += strings[word.toLowerCase()] ?? word;
      }
      skipWs();
      // "a" # "b" の連結
      if (src[i] === '#') {
        i++;
        continue;
      }
      return out;
    }
  };

  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at < 0) {
      break;
    }
    i = at + 1;
    const typeMatch = /^[a-zA-Z]+/.exec(src.slice(i));
    if (!typeMatch) {
      continue;
    }
    const type = typeMatch[0].toLowerCase();
    i += typeMatch[0].length;
    skipWs();
    const open = src[i];
    if (open !== '{' && open !== '(') {
      continue;
    }
    const close = open === '{' ? '}' : ')';
    if (type === 'comment' || type === 'preamble') {
      readBalanced(open, close);
      continue;
    }
    i++;
    if (type === 'string') {
      skipWs();
      const m = /^[^\s=]+/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        skipWs();
        if (src[i] === '=') {
          i++;
          strings[m[0].toLowerCase()] = readValue();
        }
      }
      skipWs();
      if (src[i] === close) {
        i++;
      }
      continue;
    }

    skipWs();
    const keyMatch = /^[^\s,]+/.exec(src.slice(i));
    if (!keyMatch) {
      continue;
    }
    const key = keyMatch[0];
    i += key.length;
    const fields: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (src[i] === ',') {
        i++;
        skipWs();
      }
      if (i >= src.length || src[i] === close) {
        i++;
        break;
      }
      const nameMatch = /^[^\s=,]+/.exec(src.slice(i));
      if (!nameMatch) {
        i++;
        break;
      }
      i += nameMatch[0].length;
      skipWs();
      if (src[i] !== '=') {
        continue;
      }
      i++;
      fields[nameMatch[0].toLowerCase()] = readValue().replace(/\s+/g, ' ').trim();
    }
    entries.set(key, { type, key, fields });
  }
  return entries;
}

/** "Last, First and First Last" を人ごとに分ける */
export function splitAuthors(s: string | undefined): { first: string; last: string }[] {
  if (!s) {
    return [];
  }
  return splitTopLevel(s, /\s+and\s+/)
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      const parts = splitTopLevel(a, /\s*,\s*/);
      if (parts.length >= 2) {
        return { last: parts[0], first: parts.slice(1).join(' ') };
      }
      // 「山田 太郎」のような和文名は姓名をそのまま
      const words = splitTopLevel(a, /\s+/);
      return words.length > 1 && /[a-zA-Z]/.test(a)
        ? { last: words[words.length - 1], first: words.slice(0, -1).join(' ') }
        : { last: a, first: '' };
    });
}

/** 波括弧の中は区切らずに split する */
function splitTopLevel(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    } else if (depth === 0) {
      const m = new RegExp('^(?:' + sep.source + ')').exec(s.slice(i));
      if (m && m[0].length) {
        out.push(buf);
        buf = '';
        i += m[0].length - 1;
        continue;
      }
    }
    buf += c;
  }
  out.push(buf);
  return out;
}
