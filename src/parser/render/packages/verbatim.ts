import type { Node } from '../../parser';
import { renderInline } from '../blocks';
import { parseFragment } from '../registry';
import { escapeHtml, parseKeyValues } from '../text';
import { block, Ctx, inline, Out, Package } from '../types';

/** verbatim / listings / minted。中身はトークナイザが verb ノードとして切り出し、renderVerb で描画する */
export const verbatim: Package = {
  // comment は中身ごと捨てる（トークナイザで処理）
  verbatimEnvironments: ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment'],
};

export function renderVerb(n: Extract<Node, { kind: 'verb' }>, ctx: Ctx): Out {
  // verbatim* / \verb* は空白を ␣ で見せる
  const visible = (s: string) => (n.env?.endsWith('*') ? s.replace(/ /g, '␣') : s);
  if (!n.display) {
    return inline(`<code class="verb">${escapeHtml(visible(n.text))}</code>`);
  }
  // lstlisting / minted の key=value オプションから caption と label を拾う
  const opts = parseKeyValues(n.opt ?? '');
  let caption = '';
  if (opts.caption !== undefined) {
    ctx.counters.listing++;
    ctx.currentLabel = String(ctx.counters.listing);
    caption = `<div class="caption">Listing ${ctx.counters.listing}: ${renderInline(parseFragment(opts.caption), ctx)}</div>`;
  }
  if (opts.label) {
    ctx.collected.set(opts.label, ctx.currentLabel);
  }
  return block(`<figure class="listing" data-line="${n.line}">${caption}<pre class="verbatim">${escapeHtml(visible(n.text))}</pre></figure>`);
}
