import type { BibEntry } from '../bibtex';
import type { Node } from '../parser';
import type { Locale } from './locale';
import type { CounterDef, Counters, Labels } from './numbering';

export interface RenderOptions {
  showUnknownCommands: boolean;
  /** \bibliography で指定された .bib の中身（ファイル名 → 内容）。読めなかったものは含まない */
  bibFiles?: Record<string, string>;
  /** \includegraphics のパス（ソースに書かれたまま）→ data: URI。表示できないものは含まない */
  images?: Record<string, string>;
  /** \input / \include で読み込むファイルの中身（inputKey → 内容）。読めなかったものは含まない */
  inputs?: Record<string, string>;
  /** false なら \documentclass があってもページに分けず、1 枚に続けて表示する */
  paginate?: boolean;
  /** 見つからないファイル（カンマ区切り）の注記。省略時は「〇〇 が見つかりません」 */
  notFound?: (files: string) => string;
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
  /** \bibliographystyle の名前（plain, junsrt など） */
  style: string;
}

export interface Meta {
  title?: Node[];
  author?: Node[];
  date?: Node[];
}

export interface Ctx {
  opts: RenderOptions;
  meta: Meta;
  locale: Locale;
  counters: Counters;
  labels: Labels;
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
  /** このパッケージが使うカウンタ */
  counters?: Record<string, CounterDef>;
  /** 中身を数式として KaTeX に渡す環境（描画は math ノードとして行う） */
  mathEnvironments?: string[];
  /** 中身を解釈しない環境（描画は verb ノードとして行う） */
  verbatimEnvironments?: string[];
}

export const inline = (html: string): Out => ({ html, block: false });
export const block = (html: string): Out => ({ html, block: true });
export const NOTHING = inline('');
export const ignore: CommandHandler = () => NOTHING;
