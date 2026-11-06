import { escapeHtml } from './text';
import type { Ctx } from './types';

/** カウンタの定義（パッケージが宣言する） */
export interface CounterDef {
  /** 従属する親カウンタ（\newcounter{name}[within]）。親が進むと 0 に戻り、番号は「親.自分」になる */
  within?: string;
}

/** LaTeX のカウンタ（\newcounter / \stepcounter / \setcounter / \thename） */
export class Counters {
  private readonly values = new Map<string, number>();
  private readonly defs: Map<string, CounterDef>;
  /** A, B, ... で表すカウンタ（ppendix 後の section など） */
  private readonly alpha = new Set<string>();

  constructor(defs: ReadonlyMap<string, CounterDef>) {
    this.defs = new Map(defs);
  }

  /** 文書中で定義されたカウンタ（
ewtheorem など）を追加する */
  define(name: string, def: CounterDef) {
    this.defs.set(name, def);
  }

  /** 0 に戻し、従属するカウンタも戻す */
  reset(name: string) {
    this.set(name, 0);
    this.resetChildren(name);
  }

  useAlpha(name: string) {
    this.alpha.add(name);
  }

  get(name: string): number {
    return this.values.get(name) ?? 0;
  }

  set(name: string, value: number) {
    this.values.set(name, value);
  }

  /** 1 進め、従属するカウンタを 0 に戻す */
  step(name: string) {
    this.set(name, this.get(name) + 1);
    this.resetChildren(name);
  }

  /** \thename：親をたどって 1.2.3 の形にする */
  format(name: string): string {
    const parent = this.defs.get(name)?.within;
    const n = this.get(name);
    const own = this.alpha.has(name) && n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : String(n);
    return parent ? `${this.format(parent)}.${own}` : own;
  }

  private resetChildren(name: string) {
    for (const [child, def] of this.defs) {
      if (def.within === name) {
        this.set(child, 0);
        this.resetChildren(child);
      }
    }
  }
}

/** \label と \ref の対応 */
export class Labels {
  /** 直前に振られた番号（LaTeX の \@currentlabel） */
  current = '';
  private readonly defined = new Map<string, string>();
  private readonly refs: string[] = [];

  /** \label{key}：直前に振られた番号に結びつける */
  define(key: string) {
    this.defined.set(key, this.current);
  }

  /**
   * \ref{key} の位置に置く目印。前方参照はこの時点で番号が分からないので、
   * 文書を描き終えてから resolve で番号に置き換える
   */
  ref(key: string): string {
    this.refs.push(key);
    return `${this.refs.length - 1}`;
  }

  /** 目印を番号にする。未定義のラベルは LaTeX と同じく ?? */
  resolve(html: string): string {
    return html.replace(/(\d+)/g, (_, i: string) => escapeHtml(this.defined.get(this.refs[+i]) ?? '??'));
  }
}

/** \refstepcounter：カウンタを進め、その番号を \label の対象にする。番号を返す */
export function refStepCounter(ctx: Ctx, name: string): string {
  ctx.counters.step(name);
  ctx.labels.current = ctx.counters.format(name);
  return ctx.labels.current;
}
