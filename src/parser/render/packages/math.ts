import type { Node } from '../../parser';
import { escapeHtml } from '../text';
import { refStepCounter } from '../numbering';
import { block, Ctx, inline, Out, Package } from '../types';

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

/** 数式環境（amsmath 相当）。中身はトークナイザが math ノードとして切り出し、renderMath で描画する */
export const math: Package = {
  counters: { equation: {} },
  mathEnvironments: [
    'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
    'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math',
  ],
};

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
      ctx.labels.current = userTag[1];
    } else if (numbered && !suppressed) {
      tag = ` \\tag{${refStepCounter(ctx, 'equation')}}`;
    }
    return stripLabels(row.replace(/\\(nonumber|notag)(?![a-zA-Z])/g, ''), ctx) + tag;
  });
  const src = kenv ? `\\begin{${kenv}}${out.join('\\\\')}\\end{${kenv}}` : out.join('');
  return block(`<div ${attr} data-line="${n.line}">${escapeHtml(src)}</div>`);
}

/** 数式中の \label{...} を取り除き、直前の番号に対応付ける（KaTeX は \label 非対応） */
function stripLabels(tex: string, ctx: Ctx): string {
  return tex.replace(/\\label\s*\{([^}]*)\}/g, (_, key: string) => {
    ctx.labels.define(key.trim());
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
