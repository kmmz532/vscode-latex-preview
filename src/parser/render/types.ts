import type { BibEntry } from '../bibtex';
import type { Node } from '../parser';

export interface RenderOptions {
  showUnknownCommands: boolean;
  /** \bibliography で指定された .bib の中身（ファイル名 → 内容）。読めなかったものは含まない */
  bibFiles?: Record<string, string>;
  /** \includegraphics のパス（ソースに書かれたまま）→ data: URI。表示できないものは含まない */
  images?: Record<string, string>;
}

export interface RenderResult {
  html: string;
  /** 文書中の \newcommand 等。数式の描画時に KaTeX へ渡す */
  macros: Record<string, string>;
}

/** 文献リストの状態（描画前に文書全体を走査して作る） */
export interface BibState {
  /** .bib のエントリ */
  entries: Map<string, BibEntry>;
  /** キー → 表示ラベル（1, 2, ... や Knu84） */
  labels: Map<string, string>;
  /** 文献リストに出すキー（並び順どおり） */
  keys: string[];
}

export interface Meta {
  title?: Node[];
  author?: Node[];
  date?: Node[];
}

export interface Ctx {
  opts: RenderOptions;
  meta: Meta;
  /** 日本語文書クラス（jsarticle 等）なら「図」「表」、それ以外は Figure / Table */
  japanese: boolean;
  counters: { figure: number; table: number; section: number[]; equation: number; listing: number };
  /** \ref で引く番号（前回の描画パスで集めたもの。前方参照のため 2 回描画する） */
  labels: Map<string, string>;
  /** 今回の描画パスで集めた \label */
  collected: Map<string, string>;
  /** 直前に振られた番号（LaTeX の \@currentlabel） */
  currentLabel: string;
  /** 描画中の float 環境（\caption の番号付けに使う） */
  float?: 'figure' | 'table';
  bib: BibState;
}

/** ブロック要素かどうかを付けたレンダリング結果 */
export interface Out {
  html: string;
  block: boolean;
}

export type CommandNode = Extract<Node, { kind: 'command' }>;
export type EnvNode = Extract<Node, { kind: 'env' }>;
export type CommandHandler = (n: CommandNode, ctx: Ctx) => Out;
export type EnvHandler = (n: EnvNode, ctx: Ctx) => Out;

export interface CommandDef {
  /** 必須引数の数。省略時は後続の {...} をすべて引数として取る */
  args?: number;
  /** 省略時は未知のコマンドと同じ扱い（引数の数だけ教えたいときに使う） */
  render?: CommandHandler;
}

export interface EnvDef {
  /** \begin{name} 直後の必須引数の数 */
  args?: number;
  render?: EnvHandler;
}

/**
 * LaTeX のパッケージに相当する機能のまとまり。
 * コマンドの構文（引数の数）と描画をここで一緒に定義し、パーサとレンダラの両方が参照する
 */
export interface Package {
  commands?: Record<string, CommandHandler | CommandDef>;
  environments?: Record<string, EnvHandler | EnvDef>;
  /** 中身を数式として KaTeX に渡す環境（描画は math ノードとして行う） */
  mathEnvironments?: string[];
  /** 中身を解釈しない環境（描画は verb ノードとして行う） */
  verbatimEnvironments?: string[];
}

export const inline = (html: string): Out => ({ html, block: false });
export const block = (html: string): Out => ({ html, block: true });
export const NOTHING = inline('');
export const ignore: CommandHandler = () => NOTHING;
