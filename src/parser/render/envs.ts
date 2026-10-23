import type { Node } from '../parser';
import { renderTheBibliography } from './bibliography';
import { renderBlocks } from './blocks';
import { tabular } from './tabular';
import { renderText } from './text';
import { block, EnvHandler } from './types';

/** \item ごとに子ノードを分割する */
function splitItems(children: Node[]): { opt?: string; nodes: Node[] }[] {
  const items: { opt?: string; nodes: Node[] }[] = [];
  for (const c of children) {
    if (c.kind === 'command' && c.name === 'item') {
      items.push({ opt: c.opt, nodes: [] });
    } else if (items.length) {
      items[items.length - 1].nodes.push(c);
    }
  }
  return items;
}

const list = (tag: 'ul' | 'ol'): EnvHandler => (n, ctx) => {
  const lis = splitItems(n.children)
    .map((it) => {
      const label = it.opt !== undefined ? `<span class="item-label">${renderText(it.opt)}</span> ` : '';
      return `<li${it.opt !== undefined ? ' class="custom"' : ''}>${label}${renderBlocks(it.nodes, ctx)}</li>`;
    })
    .join('');
  return block(`<${tag} data-line="${n.line}">${lis}</${tag}>`);
};

const container = (cls: string): EnvHandler => (n, ctx) =>
  block(`<div class="${cls}" data-line="${n.line}">${renderBlocks(n.children, ctx)}</div>`);

const float = (kind: 'figure' | 'table'): EnvHandler => (n, ctx) => {
  const prev = ctx.float;
  ctx.float = kind;
  const body = renderBlocks(n.children, ctx);
  ctx.float = prev;
  // 2 段組での figure* は段をまたぐ
  const span = n.name.endsWith('*') ? ' span' : '';
  return block(`<figure class="float ${kind}${span}" data-line="${n.line}">${body}</figure>`);
};

export const ENVS: Record<string, EnvHandler> = {
  thebibliography: renderTheBibliography,
  tabular,
  'tabular*': tabular,
  tabularx: tabular,
  figure: float('figure'),
  'figure*': float('figure'),
  table: float('table'),
  'table*': float('table'),
  document: (n, ctx) => block(renderBlocks(n.children, ctx)),
  itemize: list('ul'),
  enumerate: list('ol'),
  description: (n, ctx) => {
    const items = splitItems(n.children)
      .map((it) => `<dt>${renderText(it.opt ?? '')}</dt><dd>${renderBlocks(it.nodes, ctx)}</dd>`)
      .join('');
    return block(`<dl data-line="${n.line}">${items}</dl>`);
  },
  center: container('center'),
  flushleft: container('flushleft'),
  flushright: container('flushright'),
  quote: container('quote'),
  quotation: container('quote'),
  abstract: (n, ctx) =>
    block(`<div class="abstract" data-line="${n.line}"><div class="abstract-title">Abstract</div>${renderBlocks(n.children, ctx)}</div>`),
};
