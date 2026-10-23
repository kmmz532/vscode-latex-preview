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
}

/** マクロ定義を行うコマンド */
const DEFINERS = new Set([
  'newcommand', 'newcommand*', 'renewcommand', 'renewcommand*', 'providecommand', 'providecommand*',
  'DeclareRobustCommand', 'DeclareRobustCommand*',
]);
const DEFS = new Set(['def', 'gdef', 'edef', 'xdef']);

/** 再帰的なマクロで止まらなくなるのを防ぐ上限 */
const MAX_EXPANSIONS = 10000;

export interface ParseResult {
  nodes: Node[];
  /** KaTeX に渡すマクロ（\name → 本体の TeX ソース） */
  macros: Record<string, string>;
}

export function parse(src: string, syntax: Syntax): Node[] {
  return parseDocument(src, syntax).nodes;
}

export function parseDocument(src: string, syntax: Syntax): ParseResult {
  const parser = new Parser(tokenize(src, syntax), syntax);
  const nodes = parser.parseUntil(() => false);
  return { nodes, macros: parser.katexMacros() };
}

class Parser {
  private pos = 0;
  private readonly macros = new Map<string, Macro>();
  private expansions = 0;
  constructor(
    private tokens: Token[],
    private readonly syntax: Syntax
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
        if (this.macros.has(t.name) && this.expansions < MAX_EXPANSIONS) {
          this.expand(this.macros.get(t.name)!, t.line);
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

  /** \def\name#1#2{body}（区切り付きパラメータは非対応） */
  private defineDef() {
    this.skipWhitespace();
    const t = this.peek();
    if (t?.type !== 'command') {
      return;
    }
    this.pos++;
    let nargs = 0;
    const params = this.peek();
    if (params?.type === 'text' && /^(\s*#\d)+\s*$/.test(params.value)) {
      nargs = (params.value.match(/#\d/g) ?? []).length;
      this.pos++;
    }
    this.macros.set(t.name, { nargs, body: this.readRawArg() });
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

  /** マクロを展開し、結果のトークンを現在位置に差し込む */
  private expand(m: Macro, line: number) {
    this.expansions++;
    const args: Token[][] = [];
    if (m.defaultOpt) {
      const opt = this.readOpt();
      args.push(opt !== undefined ? tokenize(opt, this.syntax) : m.defaultOpt);
    }
    while (args.length < m.nargs) {
      args.push(this.readRawArg());
    }
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
  }

  /** 現在位置の \end{...} の環境名 */
  private endName(): string {
    const lb = this.tokens[this.pos + 1];
    const tx = this.tokens[this.pos + 2];
    return lb?.type === 'lbrace' && tx?.type === 'text' ? tx.value.trim() : '';
  }
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
