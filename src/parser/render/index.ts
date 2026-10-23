import { computeLayout } from '../docclass';
import { Node, parseDocument } from '../parser';
import { prepareBib } from './packages/bibliography';
import { renderColumns } from './blocks';
import { localeFor } from './locale';
import { Counters, Labels } from './numbering';
import { registry } from './registry';
import { escapeHtml, plain } from './text';
import type { Ctx, Meta, RenderOptions, RenderResult } from './types';

export type { RenderOptions, RenderResult } from './types';
export { escapeHtml } from './text';

export function renderDocument(src: string, opts: RenderOptions): RenderResult {
  let nodes: Node[];
  let macros: Record<string, string>;
  try {
    ({ nodes, macros } = parseDocument(src, registry().syntax));
  } catch (e) {
    return { html: `<pre class="error">Parse error: ${escapeHtml(String(e))}</pre>`, macros: {} };
  }
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
  const paged = nodes.some((n) => n.kind === 'command' && n.name === 'documentclass') ? ' paged' : '';
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
