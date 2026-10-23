import { computeLayout } from '../docclass';
import { Node, parseDocument } from '../parser';
import { prepareBib } from './packages/bibliography';
import { renderColumns } from './blocks';
import { localeFor } from './locale';
import { Counters, Labels } from './numbering';
import { registry } from './registry';
import { collectResources, DocumentResources } from './resources';
import { escapeHtml, plain } from './text';
import type { Ctx, Meta, RenderOptions, RenderResult } from './types';

export type { RenderOptions, RenderResult } from './types';
export type { DocumentResources } from './resources';
export { escapeHtml } from './text';

/** 解析の結果。描画の前に参照ファイルを読み込めるよう、構文木と参照を分けて返す */
export type Analysis =
  | { ok: true; nodes: Node[]; macros: Record<string, string>; resources: DocumentResources }
  | { ok: false; error: string; resources: DocumentResources };

/**
 * ソースを構文木にし、外部ファイルの参照を集める。
 * inputs は \input / \include で読み込むファイルの中身。読み込んだファイルがさらに \input していれば
 * resources.inputs に出るので、拡張機能側はそれを読んで解析し直す
 */
export function analyzeDocument(src: string, inputs?: Record<string, string>): Analysis {
  try {
    const { nodes, macros, missingInputs } = parseDocument(src, registry().syntax, inputs);
    return { ok: true, nodes, macros, resources: collectResources(nodes, missingInputs) };
  } catch (e) {
    return { ok: false, error: String(e), resources: collectResources([]) };
  }
}

export function renderDocument(src: string, opts: RenderOptions): RenderResult {
  return renderAnalysis(analyzeDocument(src, opts.inputs), opts);
}

/** 解析結果を HTML にする（参照ファイルの中身は opts で渡す） */
export function renderAnalysis(analysis: Analysis, opts: RenderOptions): RenderResult {
  if (!analysis.ok) {
    return { html: `<pre class="error">Parse error: ${escapeHtml(analysis.error)}</pre>`, macros: {} };
  }
  const { nodes, macros } = analysis;
  const layout = computeLayout(nodes, plain);
  const meta: Meta = {};
  collectMeta(nodes, meta);
  const bib = prepareBib(nodes, opts.bibFiles ?? {});
  // \begin{document} があればその中身だけを描画（プリアンブル自体は描画しない）
  const doc = nodes.find((n) => n.kind === 'env' && n.name === 'document');
  const body = doc && doc.kind === 'env' ? doc.children : nodes;
  const ctx: Ctx = {
    opts,
    meta,
    locale: localeFor(layout.japanese),
    counters: new Counters(registry().counters),
    labels: new Labels(),
    bib,
  };
  // \ref は目印で出しておき、すべての \label が揃ってから番号に置き換える
  const inner = ctx.labels.resolve(renderColumns(body, layout.twoColumn, ctx));
  const style =
    `--fs:${layout.fontSize};--lh:${layout.lineHeight};--indent:${layout.parindent};` +
    `--textwidth:${layout.textwidth};--textheight:${layout.textheight};--colsep:${layout.columnsep}`;
  // \documentclass がある完全な文書だけページ分割する（断片はそのまま流す）
  const paged =
    opts.paginate !== false && nodes.some((n) => n.kind === 'command' && n.name === 'documentclass') ? ' paged' : '';
  const html = `<div class="doc ${layout.japanese ? 'ja' : 'en'}${paged}" style="${style}">${inner}</div>`;
  return { html, macros };
}

function collectMeta(nodes: Node[], meta: Meta) {
  for (const n of nodes) {
    if (n.kind === 'command' && (n.name === 'title' || n.name === 'author' || n.name === 'date')) {
      meta[n.name] = n.args[0] ?? [];
    } else if (n.kind === 'env' && n.name === 'document') {
      collectMeta(n.children, meta);
    }
  }
}
