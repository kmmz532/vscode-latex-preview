import { computeLayout } from '../docclass';
import { Node, parseDocument } from '../parser';
import { prepareBib } from './bibliography';
import { renderColumns } from './blocks';
import { escapeHtml, plain } from './text';
import type { Ctx, Meta, RenderOptions, RenderResult } from './types';

export type { RenderOptions, RenderResult } from './types';
export { escapeHtml } from './text';

export function renderDocument(src: string, opts: RenderOptions): RenderResult {
  let nodes: Node[];
  let macros: Record<string, string>;
  try {
    ({ nodes, macros } = parseDocument(src));
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
  const renderPass = (labels: Map<string, string>) => {
    const ctx: Ctx = {
      opts,
      meta,
      japanese: layout.japanese,
      counters: { figure: 0, table: 0, section: [0, 0, 0], equation: 0, listing: 0 },
      labels,
      collected: new Map(),
      currentLabel: '',
      bib,
    };
    return { html: renderColumns(body, layout.twoColumn, ctx), collected: ctx.collected };
  };
  // 1 回目で \label を集め、2 回目でその番号を使って \ref を埋める
  const first = renderPass(new Map());
  const inner = first.collected.size ? renderPass(first.collected).html : first.html;
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
