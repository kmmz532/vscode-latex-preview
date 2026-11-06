import { renderBlocks, renderInline } from '../blocks';
import { refStepCounter } from '../numbering';
import { escapeHtml, plain } from '../text';
import { block, CommandHandler, Ctx, EnvHandler, EnvNode, NOTHING, Package, Theorem } from '../types';

/** 見出し（「Theorem 1 (注)」）を本文の最初の段落の頭に差し込む。段落で始まらなければ独立した行にする */
function withHead(body: string, head: string): string {
  const m = /^<p([^>]*)>/.exec(body);
  return m ? `<p${m[1]}>${head} ${body.slice(m[0].length)}` : `<p>${head}</p>${body}`;
}

/** \newtheorem{name}[共有するカウンタ]{見出し}[親カウンタ] */
const newtheorem: CommandHandler = (n, ctx) => {
  const name = plain(n.args[0]).trim();
  if (!name) {
    return NOTHING;
  }
  const star = n.name.endsWith('*');
  const shared = n.opt?.trim();
  const within = plain(n.args[2]).trim();
  if (!star && !shared) {
    ctx.counters.define(name, within ? { within } : {});
  }
  ctx.theorems.set(name, {
    title: renderInline(n.args[1], ctx),
    counter: star ? undefined : shared || name,
    style: ctx.theoremStyle.replace(/[^\w-]/g, ''),
  });
  return NOTHING;
};

export function renderTheorem(n: EnvNode, th: Theorem, ctx: Ctx) {
  const num = th.counter ? ` ${refStepCounter(ctx, th.counter)}` : '';
  const note = n.opt ? ` <span class="thm-note">(${escapeHtml(n.opt)})</span>` : '';
  const head = `<span class="thm-head">${th.title}${num}</span>${note}`;
  return block(
    `<div class="theorem ${th.style}" data-line="${n.line}">${withHead(renderBlocks(n.children, ctx), head)}</div>`
  );
}

const proof: EnvHandler = (n, ctx) => {
  const name = n.opt ?? ctx.locale.proofName;
  const head = `<span class="thm-head">${name}.</span>`;
  let body = withHead(renderBlocks(n.children, ctx), head);
  // 証明の終わりに □ を付ける
  const end = body.lastIndexOf('</p>');
  body = end >= 0 ? `${body.slice(0, end)}<span class="qed">□</span>${body.slice(end)}` : body;
  return block(`<div class="theorem proof" data-line="${n.line}">${body}</div>`);
};

export const theorem: Package = {
  commands: {
    newtheorem,
    'newtheorem*': newtheorem,
    theoremstyle: {
      args: 1,
      render: (n, ctx) => {
        ctx.theoremStyle = plain(n.args[0]).trim() || 'plain';
        return NOTHING;
      },
    },
  },
  environments: { proof },
};
