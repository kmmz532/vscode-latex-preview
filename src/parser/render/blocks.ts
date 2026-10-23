import { Node, parse } from '../parser';
import { COMMANDS } from './commands';
import { ENVS } from './envs';
import { renderMath, renderVerb } from './math';
import { escapeHtml, renderText } from './text';
import { block, CommandNode, Ctx, EnvNode, inline, NOTHING, Out } from './types';

/** \onecolumn / \twocolumn で区切って段組みごとにまとめる */
export function renderColumns(nodes: Node[], twoColumn: boolean, ctx: Ctx): string {
  let html = '';
  let segment: Node[] = [];
  /** \twocolumn[...] の段抜き部分 */
  let header = '';
  const flush = () => {
    const inner = renderBlocks(segment, ctx);
    if (inner.trim() || header) {
      html += twoColumn ? `<div class="twocolumn">${header}${inner}</div>\n` : header + inner;
    }
    segment = [];
    header = '';
  };
  for (const n of nodes) {
    if (n.kind === 'command' && (n.name === 'onecolumn' || n.name === 'twocolumn')) {
      flush();
      twoColumn = n.name === 'twocolumn';
      // \twocolumn[...] のオプション引数は段組みをまたいで 1 列で出す
      if (n.opt) {
        header = `<div class="colspan">${renderBlocks(parse(n.opt), ctx)}</div>`;
      }
    } else {
      segment.push(n);
    }
  }
  flush();
  return html;
}

/** ブロック文脈：インライン要素の連続を <p> でまとめる */
export function renderBlocks(nodes: Node[], ctx: Ctx): string {
  let html = '';
  let para = '';
  let paraLine = -1;
  let noindent = false;
  const flush = () => {
    if (para.trim()) {
      html += `<p${noindent ? ' class="noindent"' : ''} data-line="${paraLine}">${para.trim()}</p>\n`;
    }
    para = '';
    paraLine = -1;
    noindent = false;
  };
  for (const n of nodes) {
    if (n.kind === 'parbreak') {
      flush();
      continue;
    }
    if (n.kind === 'command' && n.name === 'noindent' && !para.trim()) {
      noindent = true;
      continue;
    }
    const out = renderNode(n, ctx);
    if (out.block) {
      flush();
      html += out.html + '\n';
    } else {
      if (paraLine < 0 && out.html.trim()) {
        paraLine = n.line;
      }
      para += out.html;
    }
  }
  flush();
  return html;
}

export function renderInline(nodes: Node[] | undefined, ctx: Ctx): string {
  if (!nodes) {
    return '';
  }
  return nodes.map((n) => (n.kind === 'parbreak' ? '<br>' : renderNode(n, ctx).html)).join('');
}

function renderNode(n: Node, ctx: Ctx): Out {
  switch (n.kind) {
    case 'text':
      return inline(renderText(n.value));
    case 'group':
      return inline(renderInline(n.children, ctx));
    case 'math':
      return renderMath(n, ctx);
    case 'verb':
      return renderVerb(n, ctx);
    case 'parbreak':
      return NOTHING;
    case 'command': {
      const h = COMMANDS[n.name];
      return h ? h(n, ctx) : renderUnknownCommand(n, ctx);
    }
    case 'env': {
      const h = ENVS[n.name];
      return h ? h(n, ctx) : renderUnknownEnv(n, ctx);
    }
  }
}

function renderUnknownCommand(n: CommandNode, ctx: Ctx): Out {
  const args = n.args.map((a) => renderInline(a, ctx));
  if (!ctx.opts.showUnknownCommands) {
    return inline(args.join(' '));
  }
  const opt = n.opt !== undefined ? `[${escapeHtml(n.opt)}]` : '';
  const shown = args.map((a) => `{${a}}`).join('');
  return inline(`<span class="unknown">\\${escapeHtml(n.name)}${opt}${shown}</span>`);
}

function renderUnknownEnv(n: EnvNode, ctx: Ctx): Out {
  const body = renderBlocks(n.children, ctx);
  if (!ctx.opts.showUnknownCommands) {
    return block(`<div data-line="${n.line}">${body}</div>`);
  }
  return block(
    `<div class="unknown-env" data-line="${n.line}"><div class="env-name">${escapeHtml(n.name)}</div>${body}</div>`
  );
}
