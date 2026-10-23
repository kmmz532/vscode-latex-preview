export type Token =
  | { type: 'command'; name: string; line: number }
  | { type: 'lbrace'; line: number }
  | { type: 'rbrace'; line: number }
  | { type: 'math'; tex: string; display: boolean; env?: string; line: number }
  | { type: 'verb'; text: string; display: boolean; env?: string; opt?: string; line: number }
  | { type: 'parbreak'; line: number }
  | { type: 'text'; value: string; line: number };

/** 中身を解釈せずそのまま表示する環境 */
const VERB_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment']);

/** 数式として生のまま KaTeX に渡す環境 */
export const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math',
]);

/** ひらがな・カタカナ・漢字 */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 0;
  let text = '';
  let textLine = 0;

  const flushText = () => {
    if (text) {
      tokens.push({ type: 'text', value: text, line: textLine });
      text = '';
    }
  };
  const pushText = (s: string) => {
    if (!text) {
      textLine = line;
    }
    text += s;
  };
  const advance = (to: number) => {
    for (let k = i; k < to; k++) {
      if (src[k] === '\n') {
        line++;
      }
    }
    i = to;
  };
  /** 閉じ区切りを探して数式トークンにする。見つからなければ false */
  const readMath = (open: string, close: string, display: boolean, env?: string): boolean => {
    const start = i + open.length;
    const end = findUnescaped(src, close, start);
    if (end < 0) {
      return false;
    }
    flushText();
    tokens.push({ type: 'math', tex: src.slice(start, end), display, env, line });
    advance(end + close.length);
    return true;
  };

  while (i < src.length) {
    const c = src[i];

    if (c === '%') {
      const nl = src.indexOf('\n', i);
      // コメントと直後の改行（と次行の先頭空白）を読み飛ばす
      if (nl < 0) {
        i = src.length;
      } else {
        let j = nl + 1;
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) {
          j++;
        }
        advance(j);
      }
      continue;
    }

    if (c === '\\') {
      const next = src[i + 1];
      if (next === '(' && readMath('\\(', '\\)', false)) {
        continue;
      }
      if (next === '[' && readMath('\\[', '\\]', true)) {
        continue;
      }
      if (src.startsWith('\\begin', i)) {
        const m = /^\\begin\s*\{([^}]+)\}/.exec(src.slice(i, i + 64));
        if (m && MATH_ENVS.has(m[1])) {
          const close = `\\end{${m[1]}}`;
          const end = src.indexOf(close, i + m[0].length);
          if (end >= 0) {
            flushText();
            tokens.push({ type: 'math', tex: src.slice(i + m[0].length, end), display: true, env: m[1], line });
            advance(end + close.length);
            continue;
          }
        }
        if (m && VERB_ENVS.has(m[1])) {
          const close = `\\end{${m[1]}}`;
          let p = i + m[0].length;
          // \begin{lstlisting}[caption=...] / \begin{minted}[opts]{lang} の引数
          let opt: string | undefined;
          const om = /^\[([^\]\n]*)\]/.exec(src.slice(p));
          if (om) {
            opt = om[1];
            p += om[0].length;
          }
          if (m[1] === 'minted') {
            const lm = /^\{([^}]*)\}/.exec(src.slice(p));
            if (lm) {
              opt = (opt ? opt + ',' : '') + `language=${lm[1]}`;
              p += lm[0].length;
            }
          }
          const end = src.indexOf(close, p);
          if (end >= 0) {
            flushText();
            // \begin{...} の行末の改行と、\end の直前の行の改行は含めない
            const body = src.slice(p, end).replace(/^[ \t]*\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
            if (m[1] !== 'comment') {
              tokens.push({ type: 'verb', text: body, display: true, env: m[1], opt, line });
            }
            advance(end + close.length);
            continue;
          }
        }
      }
      // \verb|...| / \verb*|...| / \lstinline|...| / \lstinline{...}
      const vm = /^\\(verb\*?|lstinline)(?![a-zA-Z])(\[[^\]]*\])?/.exec(src.slice(i, i + 64));
      if (vm) {
        const p = i + vm[0].length;
        const delim = src[p];
        const closeCh = delim === '{' ? '}' : delim;
        const end = delim && !/\s/.test(delim) ? src.indexOf(closeCh, p + 1) : -1;
        if (end >= 0 && !src.slice(p + 1, end).includes('\n')) {
          flushText();
          tokens.push({ type: 'verb', text: src.slice(p + 1, end), display: false, env: vm[1] === 'verb*' ? 'verb*' : undefined, line });
          advance(end + 1);
          continue;
        }
      }
      if (next === undefined) {
        pushText('\\');
        i++;
        continue;
      }
      flushText();
      let name: string;
      // pTeX と同じく和文文字もコマンド名に使える（\西暦 など）。英字と和文は混ぜない
      const letter = /[a-zA-Z@]/.test(next) ? /[a-zA-Z@]/ : CJK.test(next) ? CJK : undefined;
      if (letter) {
        let j = i + 1;
        while (j < src.length && letter.test(src[j])) {
          j++;
        }
        name = src.slice(i + 1, j);
        // \foo* は 1 つのコマンドとして扱う
        if (src[j] === '*') {
          name += '*';
          j++;
        }
        tokens.push({ type: 'command', name, line });
        advance(j);
        // コマンド名直後の空白は無視
        let k = i;
        while (k < src.length && (src[k] === ' ' || src[k] === '\t')) {
          k++;
        }
        advance(k);
      } else {
        tokens.push({ type: 'command', name: next, line });
        advance(i + 2);
      }
      continue;
    }

    if (c === '$') {
      if (src[i + 1] === '$' && readMath('$$', '$$', true)) {
        continue;
      }
      if (src[i + 1] !== '$' && readMath('$', '$', false)) {
        continue;
      }
      pushText(c);
      i++;
      continue;
    }

    if (c === '{' || c === '}') {
      flushText();
      tokens.push({ type: c === '{' ? 'lbrace' : 'rbrace', line });
      i++;
      continue;
    }

    if (c === '\n') {
      // 空行（空白のみの行を含む）は段落区切り
      const m = /^\n[ \t]*\n\s*/.exec(src.slice(i, i + 256));
      if (m) {
        flushText();
        tokens.push({ type: 'parbreak', line });
        advance(i + m[0].length);
        continue;
      }
      // 改行から始まるテキストは次の行のものとして扱う（見出し直後の段落の行番号がずれないように）
      if (!text) {
        textLine = line + 1;
        text = ' ';
      } else {
        text += ' ';
      }
      line++;
      i++;
      continue;
    }

    pushText(c);
    i++;
  }
  flushText();
  return tokens;
}

function findUnescaped(src: string, needle: string, from: number): number {
  let i = from;
  while (i < src.length) {
    const idx = src.indexOf(needle, i);
    if (idx < 0) {
      return -1;
    }
    let bs = 0;
    for (let k = idx - 1; k >= from && src[k] === '\\'; k--) {
      bs++;
    }
    // \$ のようにエスケープされている場合はスキップ（\( \[ などの区切りは needle 自体が \ で始まる）
    if (needle[0] !== '\\' && bs % 2 === 1) {
      i = idx + 1;
      continue;
    }
    return idx;
  }
  return -1;
}
