import { Node, parse } from '../parser';
import { renderInline } from './blocks';
import { escapeHtml, parseKeyValues } from './text';
import { block, Ctx, inline, Out } from './types';

/** 番号付きの数式環境と、KaTeX に渡すときの番号なし版（番号は \tag で自前で振る） */
const MATH_ENV_KATEX: Record<string, string | undefined> = {
  equation: undefined,
  displaymath: undefined,
  math: undefined,
  align: 'align*',
  eqnarray: 'align*',
  gather: 'gather*',
  // KaTeX は multline 非対応なので gather で代用
  multline: 'gather*',
};
const NUMBERED_MATH = new Set(['equation', 'align', 'eqnarray', 'gather', 'multline']);

export function renderMath(n: Extract<Node, { kind: 'math' }>, ctx: Ctx): Out {
  const attr = `class="math" data-display="${n.display ? 1 : 0}"`;
  if (!n.display) {
    return inline(`<span ${attr}>${escapeHtml(stripLabels(n.tex, ctx))}</span>`);
  }
  const base = (n.env ?? '').replace(/\*$/, '');
  const numbered = !!n.env && !n.env.endsWith('*') && NUMBERED_MATH.has(base);
  const kenv = MATH_ENV_KATEX[base];
  // 行ごとに番号を振る環境は \\ で分ける（multline は最後の行だけに番号）
  const rows = kenv ? splitMathRows(n.tex) : [n.tex];
  const out = rows.map((row, i) => {
    const suppressed = /\\(nonumber|notag)(?![a-zA-Z])/.test(row) || (base === 'multline' && i < rows.length - 1);
    const userTag = /\\tag\*?\{([^}]*)\}/.exec(row);
    let tag = '';
    if (userTag) {
      ctx.currentLabel = userTag[1];
    } else if (numbered && !suppressed) {
      ctx.currentLabel = String(++ctx.counters.equation);
      tag = ` \\tag{${ctx.currentLabel}}`;
    }
    return stripLabels(row.replace(/\\(nonumber|notag)(?![a-zA-Z])/g, ''), ctx) + tag;
  });
  const src = kenv ? `\\begin{${kenv}}${out.join('\\\\')}\\end{${kenv}}` : out.join('');
  return block(`<div ${attr} data-line="${n.line}">${escapeHtml(src)}</div>`);
}

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
    caption = `<div class="caption">Listing ${ctx.counters.listing}: ${renderInline(parse(opts.caption), ctx)}</div>`;
  }
  if (opts.label) {
    ctx.collected.set(opts.label, ctx.currentLabel);
  }
  return block(`<figure class="listing" data-line="${n.line}">${caption}<pre class="verbatim">${escapeHtml(visible(n.text))}</pre></figure>`);
}

/** 数式中の \label{...} を取り除き、直前の番号に対応付ける（KaTeX は \label 非対応） */
function stripLabels(tex: string, ctx: Ctx): string {
  return tex.replace(/\\label\s*\{([^}]*)\}/g, (_, key: string) => {
    ctx.collected.set(key.trim(), ctx.currentLabel);
    return '';
  });
}

/** 数式を最上位の \\ で行に分ける（{...} や \begin...\end の中は分けない） */
function splitMathRows(tex: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') {
      if (tex.startsWith('\\begin', i)) {
        depth++;
      } else if (tex.startsWith('\\end', i)) {
        depth--;
      } else if (tex[i + 1] === '\\' && depth === 0) {
        rows.push(tex.slice(start, i));
        start = i + 2;
      }
      i++;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    }
  }
  rows.push(tex.slice(start));
  // 末尾の \\ による空行は捨てる
  return rows.filter((r, i) => i < rows.length - 1 || r.trim() || rows.length === 1);
}
