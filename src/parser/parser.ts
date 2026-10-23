import { Token, tokenize } from './tokenizer';

export type Node =
  | { kind: 'text'; value: string; line: number }
  | { kind: 'group'; children: Node[]; line: number }
  | { kind: 'command'; name: string; opt?: string; args: Node[][]; line: number }
  | { kind: 'env'; name: string; opt?: string; args: Node[][]; children: Node[]; line: number }
  | { kind: 'math'; tex: string; display: boolean; env?: string; line: number }
  | { kind: 'parbreak'; line: number };

/** 必須引数の数。未登録コマンドは後続の {...} をすべて引数として取る */
const ARITY: Record<string, number> = {
  item: 0, maketitle: 0, today: 0, LaTeX: 0, TeX: 0, centering: 0, noindent: 0,
  newpage: 0, clearpage: 0, onecolumn: 0, twocolumn: 0, tableofcontents: 0, hline: 0, par: 0, '\\': 0,
  href: 2, setlength: 2, setcounter: 2, addtolength: 2,
};

/** 環境ごとの必須引数の数 */
const ENV_ARITY: Record<string, number> = {
  tabular: 1, 'tabular*': 2, minipage: 1, thebibliography: 1,
};

export function parse(src: string): Node[] {
  return new Parser(tokenize(src)).parseUntil(() => false);
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

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
      case 'lbrace':
        return { kind: 'group', children: this.parseGroupBody(), line: t.line };
      case 'rbrace':
        // 対応しない } は文字として残す（壊れない）
        return { kind: 'text', value: '}', line: t.line };
      case 'command':
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
    const arity = ARITY[name];
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
    for (let k = 0; k < (ENV_ARITY[name] ?? 0); k++) {
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

  /** 現在位置の \end{...} の環境名 */
  private endName(): string {
    const lb = this.tokens[this.pos + 1];
    const tx = this.tokens[this.pos + 2];
    return lb?.type === 'lbrace' && tx?.type === 'text' ? tx.value.trim() : '';
  }
}
