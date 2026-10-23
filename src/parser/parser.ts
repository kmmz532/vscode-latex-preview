import { inputKey } from './inputs';
import { RawEnvironments, Token, tokenize } from './tokenizer';

export type Node =
  | { kind: 'text'; value: string; line: number }
  | { kind: 'group'; children: Node[]; line: number }
  | { kind: 'command'; name: string; opt?: string; args: Node[][]; line: number }
  | { kind: 'env'; name: string; opt?: string; args: Node[][]; children: Node[]; line: number }
  | { kind: 'math'; tex: string; display: boolean; env?: string; line: number }
  | { kind: 'verb'; text: string; display: boolean; env?: string; opt?: string; line: number }
  | { kind: 'parbreak'; line: number };

/** パーサが知っておくべきコマンド・環境の情報（レンダラのパッケージ定義から作る） */
export interface Syntax extends RawEnvironments {
  /** コマンドの必須引数の数。undefined なら後続の {...} をすべて引数として取る */
  commandArgs(name: string): number | undefined;
  /** 環境の必須引数の数 */
  envArgs(name: string): number;
}

/** \newcommand 等で定義されたマクロ */
interface Macro {
  nargs: number;
  /** 第 1 引数がオプション引数のときの既定値 */
  defaultOpt?: Token[];
  body: Token[];
  /**
   * \def の区切り付きパラメータ。[0] は #1 の前、[i] は #i の後に来るべきトークン列
   * （テキストは 1 文字ずつ、空白は ' ' 1 つにまとめる）。undefined なら区切りなし
   */
  delims?: Token[][];
}

/** トークン列上の位置（テキストトークンは文字単位で指す） */
interface Cursor {
  p: number;
  off: number;
}

/** マクロ定義を行うコマンド */
const DEFINERS = new Set([
  'newcommand', 'newcommand*', 'renewcommand', 'renewcommand*', 'providecommand', 'providecommand*',
  'DeclareRobustCommand', 'DeclareRobustCommand*',
]);
const DEFS = new Set(['def', 'gdef', 'edef', 'xdef']);

/** 再帰的なマクロで止まらなくなるのを防ぐ上限 */
const MAX_EXPANSIONS = 10000;
/** \input の入れ子（自分自身を読み込むファイルなど）で止まらなくなるのを防ぐ上限 */
const MAX_INPUTS = 100;

export interface ParseResult {
  nodes: Node[];
  /** \input / \include されたが inputs になかったファイル（inputKey、出現順・重複なし） */
  missingInputs: string[];
  /** KaTeX に渡すマクロ（\name → 本体の TeX ソース） */
  macros: Record<string, string>;
}

export function parse(src: string, syntax: Syntax): Node[] {
  return parseDocument(src, syntax).nodes;
}

/** inputs は \input / \include で読み込むファイルの中身（inputKey → 内容） */
export function parseDocument(src: string, syntax: Syntax, inputs?: Record<string, string>): ParseResult {
  const parser = new Parser(tokenize(src, syntax), syntax, inputs);
  const nodes = parser.parseUntil(() => false);
  return { nodes, macros: parser.katexMacros(), missingInputs: [...parser.missingInputs] };
}

class Parser {
  private pos = 0;
  private readonly macros = new Map<string, Macro>();
  private expansions = 0;
  private inputCount = 0;
  readonly missingInputs = new Set<string>();
  constructor(
    private tokens: Token[],
    private readonly syntax: Syntax,
    private readonly inputs?: Record<string, string>
  ) {}

  katexMacros(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, m] of this.macros) {
      out['\\' + name] = tokensToSource(m.body);
    }
    return out;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  parseUntil(stop: (t: Token) => boolean): Node[] {
    const nodes: Node[] = [];
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      if (stop(t)) {
        break;
      }
      const node = this.parseNode();
      if (node) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private parseNode(): Node | undefined {
    const t = this.tokens[this.pos++];
    switch (t.type) {
      case 'text':
        return { kind: 'text', value: t.value, line: t.line };
      case 'parbreak':
        return { kind: 'parbreak', line: t.line };
      case 'math':
        return { kind: 'math', tex: t.tex, display: t.display, env: t.env, line: t.line };
      case 'verb':
        return { kind: 'verb', text: t.text, display: t.display, env: t.env, opt: t.opt, line: t.line };
      case 'lbrace':
        return { kind: 'group', children: this.parseGroupBody(), line: t.line };
      case 'rbrace':
        // 対応しない } は文字として残す（壊れない）
        return { kind: 'text', value: '}', line: t.line };
      case 'command':
        if (DEFINERS.has(t.name)) {
          this.defineNewcommand(t.name.startsWith('provide'));
          return undefined;
        }
        if (DEFS.has(t.name)) {
          this.defineDef();
          return undefined;
        }
        if (this.macros.has(t.name) && this.expansions < MAX_EXPANSIONS && this.expand(this.macros.get(t.name)!, t.line)) {
          return undefined;
        }
        if ((t.name === 'input' || t.name === 'include') && this.insertInput(t.name, t.line)) {
          return undefined;
        }
        if (t.name === 'begin') {
          return this.parseEnv(t.line);
        }
        if (t.name === 'end') {
          // 対応しない \end{...} は読み捨てる
          this.readArg();
          return undefined;
        }
        return this.parseCommand(t.name, t.line);
    }
  }

  /** 直前の { を消費済みの状態で、対応する } まで読む */
  private parseGroupBody(): Node[] {
    const children = this.parseUntil((t) => t.type === 'rbrace');
    if (this.peek()?.type === 'rbrace') {
      this.pos++;
    }
    return children;
  }

  private readArg(): Node[] | undefined {
    this.skipSpaces();
    if (this.peek()?.type !== 'lbrace') {
      return undefined;
    }
    this.pos++;
    return this.parseGroupBody();
  }

  /** [ ... ] 形式のオプション引数（テキストとして取得） */
  private readOpt(): string | undefined {
    this.skipSpaces();
    const t = this.peek();
    if (t?.type !== 'text' || !t.value.startsWith('[')) {
      return undefined;
    }
    let buf = '';
    let p = this.pos;
    while (p < this.tokens.length) {
      const tok = this.tokens[p];
      if (tok.type === 'text') {
        const idx = tok.value.indexOf(']');
        if (idx >= 0) {
          buf += tok.value.slice(0, idx);
          const rest = tok.value.slice(idx + 1);
          if (rest) {
            this.tokens[p] = { ...tok, value: rest };
            this.pos = p;
          } else {
            this.pos = p + 1;
          }
          return buf.slice(1);
        }
        buf += tok.value;
      } else if (tok.type === 'command') {
        buf += '\\' + tok.name;
      } else if (tok.type === 'lbrace' || tok.type === 'rbrace') {
        buf += tok.type === 'lbrace' ? '{' : '}';
      } else {
        // 段落区切りなどを跨ぐ場合はオプション引数ではないとみなす
        return undefined;
      }
      p++;
    }
    return undefined;
  }

  private skipSpaces() {
    const t = this.peek();
    if (t?.type === 'text' && /^\s+$/.test(t.value) && this.tokens[this.pos + 1]?.type === 'lbrace') {
      this.pos++;
    }
  }

  private parseCommand(name: string, line: number): Node {
    const opt = this.readOpt();
    const args: Node[][] = [];
    const arity = this.syntax.commandArgs(name);
    if (arity === undefined) {
      let a: Node[] | undefined;
      // 1 文字の記号コマンド（\% \& など）は引数を取らない
      while (/^[a-zA-Z@]/.test(name) && (a = this.readArg())) {
        args.push(a);
      }
    } else {
      for (let k = 0; k < arity; k++) {
        const a = this.readArg();
        if (!a) {
          break;
        }
        args.push(a);
      }
    }
    return { kind: 'command', name, opt, args, line };
  }

  private parseEnv(line: number): Node {
    const nameNodes = this.readArg() ?? [];
    const name = nameNodes.map((n) => (n.kind === 'text' ? n.value : '')).join('').trim();
    const opt = this.readOpt();
    const args: Node[][] = [];
    for (let k = 0; k < this.syntax.envArgs(name); k++) {
      const a = this.readArg();
      if (a) {
        args.push(a);
      }
    }
    const children = this.parseUntil((t) => t.type === 'command' && t.name === 'end' && this.endName() === name);
    if (this.peek()?.type === 'command') {
      this.pos++;
      this.readArg();
    }
    return { kind: 'env', name, opt, args, children, line };
  }

  // ---- マクロ ----

  /** \newcommand{\name}[n][default]{body} / \newcommand\name... */
  private defineNewcommand(keepExisting: boolean) {
    const name = this.readMacroName();
    if (!name) {
      return;
    }
    const n = parseInt(this.readOpt() ?? '0', 10) || 0;
    const def = n > 0 ? this.readOpt() : undefined;
    const body = this.readRawArg();
    if (keepExisting && this.macros.has(name)) {
      return;
    }
    this.macros.set(name, { nargs: n, defaultOpt: def !== undefined ? tokenize(def, this.syntax) : undefined, body });
  }

  /** \def\name#1#2{body} / \def\name#1.#2\end{body}（区切り付きパラメータ） */
  private defineDef() {
    this.skipWhitespace();
    const t = this.peek();
    if (t?.type !== 'command') {
      return;
    }
    this.pos++;
    // パラメータテキストは本体の { まで
    const units: Token[] = [];
    while (this.pos < this.tokens.length) {
      const x = this.tokens[this.pos];
      if (x.type === 'lbrace' || x.type === 'parbreak') {
        break;
      }
      if (x.type === 'text') {
        for (const ch of x.value) {
          units.push({ ...x, value: ch });
        }
      } else {
        units.push(x);
      }
      this.pos++;
    }
    const delims: Token[][] = [[]];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const next = units[i + 1];
      if (u.type === 'text' && u.value === '#' && next?.type === 'text' && /\d/.test(next.value)) {
        delims.push([]);
        i++;
        continue;
      }
      const cur = delims[delims.length - 1];
      if (u.type === 'text' && /\s/.test(u.value)) {
        // 空白は 1 つにまとめ、制御綴の直後と \name の直後のものは捨てる
        const last = cur[cur.length - 1];
        if (last ? last.type === 'command' || (last.type === 'text' && last.value === ' ') : delims.length === 1) {
          continue;
        }
        cur.push({ ...u, value: ' ' });
        continue;
      }
      cur.push(u);
    }
    this.macros.set(t.name, {
      nargs: delims.length - 1,
      body: this.readRawArg(),
      delims: delims.some((d) => d.length > 0) ? delims : undefined,
    });
  }

  private readMacroName(): string | undefined {
    this.skipWhitespace();
    const t = this.peek();
    if (t?.type === 'command') {
      this.pos++;
      return t.name;
    }
    if (t?.type === 'lbrace') {
      const inner = this.readRawArg();
      const cmd = inner.find((x) => x.type === 'command');
      return cmd?.type === 'command' ? cmd.name : undefined;
    }
    return undefined;
  }

  /** 引数をトークン列のまま読む（{...} の中身、またはトークン 1 個） */
  private readRawArg(): Token[] {
    this.skipWhitespace();
    const t = this.peek();
    if (!t) {
      return [];
    }
    if (t.type !== 'lbrace') {
      this.pos++;
      // 波括弧なしのテキスト引数は先頭 1 文字だけ（\foo ab → #1 = a）
      if (t.type === 'text' && t.value.length > 1) {
        this.tokens.splice(this.pos, 0, { ...t, value: t.value.slice(1) });
        return [{ ...t, value: t.value[0] }];
      }
      return [t];
    }
    let depth = 0;
    const start = ++this.pos;
    while (this.pos < this.tokens.length) {
      const x = this.tokens[this.pos];
      if (x.type === 'lbrace') {
        depth++;
      } else if (x.type === 'rbrace') {
        if (depth === 0) {
          return this.tokens.slice(start, this.pos++);
        }
        depth--;
      }
      this.pos++;
    }
    return this.tokens.slice(start);
  }

  private skipWhitespace() {
    while (this.peek()?.type === 'text' && /^\s*$/.test((this.peek() as { value: string }).value)) {
      this.pos++;
    }
  }

  /**
   * マクロを展開し、結果のトークンを現在位置に差し込む。
   * 区切り付きパラメータが定義どおりに現れなければ何もせず false
   */
  private expand(m: Macro, line: number): boolean {
    let args: Token[][] | undefined = [];
    if (m.delims) {
      args = this.readDelimitedArgs(m.delims);
      if (!args) {
        return false;
      }
    } else {
      if (m.defaultOpt) {
        const opt = this.readOpt();
        args.push(opt !== undefined ? tokenize(opt, this.syntax) : m.defaultOpt);
      }
      while (args.length < m.nargs) {
        args.push(this.readRawArg());
      }
    }
    this.expansions++;
    const out: Token[] = [];
    for (const t of m.body) {
      if (t.type !== 'text' || !/#\d/.test(t.value)) {
        out.push({ ...t, line });
        continue;
      }
      for (const part of t.value.split(/(#\d)/)) {
        const ref = /^#(\d)$/.exec(part);
        if (ref) {
          out.push(...(args[parseInt(ref[1], 10) - 1] ?? []).map((a) => ({ ...a, line })));
        } else if (part) {
          out.push({ ...t, value: part, line });
        }
      }
    }
    this.tokens.splice(this.pos, 0, ...out);
    return true;
  }

  /** 区切り付きパラメータの引数を読む。合わなければ位置を動かさず undefined */
  private readDelimitedArgs(delims: Token[][]): Token[][] | undefined {
    const c: Cursor = { p: this.pos, off: 0 };
    // 制御綴の後の空白は読み飛ばす
    this.skipSpaceUnits(c);
    const head = this.matchDelim(c, delims[0]);
    if (!head) {
      return undefined;
    }
    Object.assign(c, head);
    const args: Token[][] = [];
    for (let i = 1; i < delims.length; i++) {
      const a = delims[i].length > 0 ? this.readUntilDelim(c, delims[i]) : this.readUndelimited(c);
      if (!a) {
        return undefined;
      }
      args.push(a);
    }
    const t = this.tokens[c.p];
    if (c.off > 0 && t?.type === 'text') {
      this.tokens[c.p] = { ...t, value: t.value.slice(c.off) };
    }
    this.pos = c.p;
    return args;
  }

  private unitAt(c: Cursor): Token | undefined {
    let t = this.tokens[c.p];
    while (t?.type === 'text' && c.off >= t.value.length) {
      c.p++;
      c.off = 0;
      t = this.tokens[c.p];
    }
    return t?.type === 'text' ? { ...t, value: t.value[c.off] } : t;
  }

  private advance(c: Cursor) {
    const t = this.tokens[c.p];
    if (t?.type === 'text' && c.off + 1 < t.value.length) {
      c.off++;
    } else {
      c.p++;
      c.off = 0;
    }
  }

  private skipSpaceUnits(c: Cursor) {
    let u: Token | undefined;
    while ((u = this.unitAt(c)) && u.type === 'text' && /\s/.test(u.value)) {
      this.advance(c);
    }
  }

  /** c の位置から区切りが続いていれば、その直後の位置 */
  private matchDelim(c: Cursor, delim: Token[]): Cursor | undefined {
    const d = { ...c };
    for (const u of delim) {
      const x = this.unitAt(d);
      if (!x) {
        return undefined;
      }
      if (u.type === 'text' && u.value === ' ') {
        // 区切りの空白は 1 文字以上の空白に合う
        if (x.type !== 'text' || !/\s/.test(x.value)) {
          return undefined;
        }
        this.skipSpaceUnits(d);
        continue;
      }
      const same = u.type === 'text' ? x.type === 'text' && x.value === u.value : u.type === 'command' && x.type === 'command' && x.name === u.name;
      if (!same) {
        return undefined;
      }
      this.advance(d);
      if (u.type === 'command') {
        this.skipSpaceUnits(d);
      }
    }
    return d;
  }

  /** 波括弧の外で区切りが現れるまで読む。全体が {...} 1 つなら外側の括弧を外す */
  private readUntilDelim(c: Cursor, delim: Token[]): Token[] | undefined {
    const out: Token[] = [];
    let depth = 0;
    for (;;) {
      if (depth === 0) {
        const end = this.matchDelim(c, delim);
        if (end) {
          Object.assign(c, end);
          break;
        }
      }
      const x = this.unitAt(c);
      // 段落を跨ぐ引数は TeX でもエラーになる
      if (!x || x.type === 'parbreak' || (x.type === 'rbrace' && depth === 0)) {
        return undefined;
      }
      if (x.type === 'lbrace') {
        depth++;
      } else if (x.type === 'rbrace') {
        depth--;
      }
      pushUnit(out, x);
      this.advance(c);
    }
    return isSingleGroup(out) ? out.slice(1, -1) : out;
  }

  /** 区切りのないパラメータ：空白を飛ばして {...} の中身か 1 文字（トークン 1 個） */
  private readUndelimited(c: Cursor): Token[] {
    this.skipSpaceUnits(c);
    const x = this.unitAt(c);
    if (!x) {
      return [];
    }
    this.advance(c);
    if (x.type !== 'lbrace') {
      return [x];
    }
    const out: Token[] = [];
    let depth = 0;
    let y: Token | undefined;
    while ((y = this.unitAt(c))) {
      this.advance(c);
      if (y.type === 'rbrace' && depth-- === 0) {
        break;
      }
      if (y.type === 'lbrace') {
        depth++;
      }
      pushUnit(out, y);
    }
    return out;
  }

  /**
   * \input{file} / \include{file} をファイルの中身のトークンに置き換える。
   * 中身はすべて \input の行のものとして扱う（スクロール同期は \input の行に合わせる）。
   * 読み込めないファイルなら位置を戻して false（通常のコマンドとして描画する）
   */
  private insertInput(name: string, line: number): boolean {
    if (this.inputCount >= MAX_INPUTS) {
      return false;
    }
    const start = this.pos;
    this.skipWhitespace();
    let file: string | undefined;
    const t = this.peek();
    const at = this.pos;
    if (t?.type === 'lbrace') {
      file = tokensToSource(this.readRawArg());
    } else if (t?.type === 'text') {
      // \input file（TeX の書き方）はファイル名を空白まで読む
      const m = /^\s*([^\s]+)/.exec(t.value);
      if (m) {
        file = m[1];
        const rest = t.value.slice(m[0].length);
        this.tokens[this.pos] = { ...t, value: rest };
        if (!rest) {
          this.pos++;
        }
      }
    }
    const key = file !== undefined ? inputKey(file) : '';
    const body = key ? this.inputs?.[key] : undefined;
    if (body === undefined) {
      if (key) {
        this.missingInputs.add(key);
      }
      if (t) {
        this.tokens[at] = t;
      }
      this.pos = start;
      return false;
    }
    this.inputCount++;
    const out = tokenize(body, this.syntax).map((x) => ({ ...x, line }));
    // \include は前後で改ページする（プレビューでは段落を区切るだけ）
    if (name === 'include') {
      out.unshift({ type: 'parbreak', line });
      out.push({ type: 'parbreak', line });
    }
    this.tokens.splice(this.pos, 0, ...out);
    return true;
  }

  /** 現在位置の \end{...} の環境名 */
  private endName(): string {
    const lb = this.tokens[this.pos + 1];
    const tx = this.tokens[this.pos + 2];
    return lb?.type === 'lbrace' && tx?.type === 'text' ? tx.value.trim() : '';
  }
}

/** 1 文字ずつ読んだテキストを隣のテキストトークンにつなげて追加する */
function pushUnit(out: Token[], u: Token) {
  const last = out[out.length - 1];
  if (u.type === 'text' && last?.type === 'text') {
    out[out.length - 1] = { ...last, value: last.value + u.value };
  } else {
    out.push(u);
  }
}

/** トークン列全体が {...} 1 つか */
function isSingleGroup(tokens: Token[]): boolean {
  if (tokens[0]?.type !== 'lbrace' || tokens[tokens.length - 1]?.type !== 'rbrace') {
    return false;
  }
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'lbrace') {
      depth++;
    } else if (t.type === 'rbrace' && --depth === 0 && i < tokens.length - 1) {
      return false;
    }
  }
  return true;
}

/** トークン列を TeX ソースに戻す（KaTeX のマクロ定義用） */
function tokensToSource(tokens: Token[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'command':
          return '\\' + t.name + (/[a-zA-Z]$/.test(t.name) ? ' ' : '');
        case 'lbrace':
          return '{';
        case 'rbrace':
          return '}';
        case 'text':
          return t.value;
        case 'parbreak':
          return '\n\n';
        case 'math':
          return t.env ? `\\begin{${t.env}}${t.tex}\\end{${t.env}}` : t.display ? `\\[${t.tex}\\]` : `$${t.tex}$`;
        case 'verb':
          return t.env ? `\\begin{${t.env}}\n${t.text}\n\\end{${t.env}}` : `\\verb|${t.text}|`;
      }
    })
    .join('');
}
