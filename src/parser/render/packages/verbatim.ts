import type { Node } from '../../parser';
import { renderInline } from '../blocks';
import { parseFragment } from '../registry';
import { escapeHtml, parseKeyValues } from '../text';
import { refStepCounter } from '../numbering';
import { block, Ctx, inline, Out, Package } from '../types';

/** verbatim / listings / minted。中身はトークナイザが verb ノードとして切り出し、renderVerb で描画する */
export const verbatim: Package = {
  counters: { listing: {} },
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
    const num = refStepCounter(ctx, 'listing');
    caption = `<div class="caption">${ctx.locale.listingName} ${num}: ${renderInline(parseFragment(opts.caption), ctx)}</div>`;
  }
  if (opts.label) {
    ctx.labels.define(opts.label);
  }
  return block(`<figure class="listing" data-line="${n.line}">${caption}<pre class="verbatim">${escapeHtml(visible(n.text))}</pre></figure>`);
}
