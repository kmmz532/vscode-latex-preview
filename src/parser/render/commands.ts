import { renderBibliography, renderCite } from './bibliography';
import { renderInline } from './blocks';
import { escapeHtml, parseKeyValues, plain, today } from './text';
import { block, CommandHandler, CommandNode, Ctx, inline, NOTHING, Out } from './types';

const wrap = (tag: string, cls?: string): CommandHandler => (n, ctx) =>
  inline(`<${tag}${cls ? ` class="${cls}"` : ''}>${renderInline(n.args[0], ctx)}</${tag}>`);

/**
 * 見出し。depth は採番の階層（section=0, subsection=1, subsubsection=2）。
 * article 系の既定（secnumdepth=3）に合わせ、それより下と * 付きは番号なし
 */
const heading = (level: number, depth?: number): CommandHandler => (n, ctx) => {
  let num = '';
  if (depth !== undefined && !n.name.endsWith('*')) {
    const c = ctx.counters.section;
    c[depth]++;
    c.fill(0, depth + 1);
    ctx.currentLabel = c.slice(0, depth + 1).join('.');
    num = `<span class="secnum">${ctx.currentLabel}</span>`;
  }
  return block(`<h${level} data-line="${n.line}">${num}${renderInline(n.args[0], ctx) || '&nbsp;'}</h${level}>`);
};

const ignore: CommandHandler = () => NOTHING;
const symbol = (s: string): CommandHandler => () => inline(s);

/** width=0.5\linewidth / 5cm などを CSS の長さにする */
function graphicsLength(s: string): string | undefined {
  const rel = /^\s*(\d*\.?\d+)?\s*\\(linewidth|textwidth|columnwidth|hsize|textheight)\s*$/.exec(s);
  if (rel) {
    const ratio = parseFloat(rel[1] ?? '1');
    return rel[2] === 'textheight' ? `calc(${ratio} * var(--textheight))` : `${ratio * 100}%`;
  }
  const m = /^\s*(\d*\.?\d+)\s*(mm|cm|in|pt|bp|em|ex|px)?\s*$/.exec(s);
  if (!m) {
    return undefined;
  }
  // 単位なしは bp（graphicx の既定）
  const unit = m[2] === 'bp' || !m[2] ? 'pt' : m[2];
  return `${m[1]}${unit}`;
}

function includegraphics(n: CommandNode, ctx: Ctx): Out {
  const file = plain(n.args[0]).trim();
  const src = ctx.opts.images?.[file];
  const opts = parseKeyValues(n.opt ?? '');
  const style: string[] = [];
  const width = opts.width !== undefined ? graphicsLength(opts.width) : undefined;
  const height = opts.height !== undefined ? graphicsLength(opts.height) : undefined;
  if (width) {
    style.push(`width:${width}`);
  }
  if (height) {
    style.push(`height:${height}`);
  }
  if (width && height && !('keepaspectratio' in opts)) {
    style.push('object-fit:fill');
  } else if (width && height) {
    style.push('object-fit:contain');
  }
  const scale = parseFloat(opts.scale ?? '');
  if (!width && !height && scale > 0) {
    style.push(`zoom:${scale}`);
  }
  if (opts.angle) {
    style.push(`rotate:${-parseFloat(opts.angle) || 0}deg`);
  }
  const css = style.length ? ` style="${style.join(';')}"` : '';
  if (src) {
    return inline(`<img class="graphics-img" src="${escapeHtml(src)}" alt="${escapeHtml(file)}"${css}>`);
  }
  // 見つからない・EPS / PDF などブラウザで表示できないものはファイル名の枠
  return inline(`<span class="graphics"${width ? ` style="width:${width}"` : ''}>${file ? escapeHtml(file) : 'image'}</span>`);
}

export const COMMANDS: Record<string, CommandHandler> = {
  part: heading(1),
  chapter: heading(1),
  'part*': heading(1),
  'chapter*': heading(1),
  section: heading(2, 0),
  'section*': heading(2, 0),
  subsection: heading(3, 1),
  'subsection*': heading(3, 1),
  subsubsection: heading(4, 2),
  'subsubsection*': heading(4, 2),
  paragraph: heading(5),
  'paragraph*': heading(5),
  subparagraph: heading(6),
  'subparagraph*': heading(6),

  textbf: wrap('strong'),
  textit: wrap('em'),
  textsl: wrap('em'),
  emph: wrap('em'),
  texttt: wrap('code'),
  underline: wrap('u'),
  textsc: wrap('span', 'sc'),
  textrm: wrap('span'),
  textsf: wrap('span', 'sf'),
  textup: wrap('span'),
  textmd: wrap('span'),
  textnormal: wrap('span'),
  mbox: wrap('span'),
  footnote: (n, ctx) => inline(`<span class="footnote">${renderInline(n.args[0], ctx)}</span>`),
  url: (n) => inline(`<code class="url">${escapeHtml(plain(n.args[0]))}</code>`),
  href: (n, ctx) => inline(`<span class="link">${renderInline(n.args[1], ctx)}</span>`),

  maketitle: (n, ctx) => {
    const { title, author, date } = ctx.meta;
    let html = `<header class="maketitle" data-line="${n.line}">`;
    if (title) {
      html += `<div class="title">${renderInline(title, ctx)}</div>`;
    }
    if (author) {
      html += `<div class="author">${renderInline(author, ctx)}</div>`;
    }
    // \date 未指定時は \today 扱い
    html += `<div class="date">${date ? renderInline(date, ctx) : today()}</div>`;
    return block(html + '</header>');
  },
  title: ignore,
  author: ignore,
  date: ignore,
  today: () => inline(today()),
  and: symbol('<span class="and"></span>'),
  thanks: (n, ctx) => inline(`<span class="footnote">${renderInline(n.args[0], ctx)}</span>`),

  cite: renderCite,
  citep: renderCite,
  citet: renderCite,
  nocite: ignore,
  // 未定義のラベルは LaTeX と同じく ??
  ref: (n, ctx) => inline(`<span class="ref">${escapeHtml(ctx.labels.get(plain(n.args[0]).trim()) ?? '??')}</span>`),
  eqref: (n, ctx) => inline(`<span class="ref">(${escapeHtml(ctx.labels.get(plain(n.args[0]).trim()) ?? '??')})</span>`),
  pageref: () => inline('<span class="ref">??</span>'),
  label: (n, ctx) => {
    ctx.collected.set(plain(n.args[0]).trim(), ctx.currentLabel);
    return NOTHING;
  },
  bibliography: renderBibliography,
  bibitem: ignore,

  caption: (n, ctx) => {
    if (!ctx.float) {
      return inline(renderInline(n.args[0], ctx));
    }
    const num = ++ctx.counters[ctx.float];
    ctx.currentLabel = String(num);
    const name = ctx.float === 'figure' ? (ctx.japanese ? '図' : 'Figure') : ctx.japanese ? '表' : 'Table';
    const sep = ctx.japanese ? '　' : ': ';
    return block(`<div class="caption" data-line="${n.line}">${name}${ctx.japanese ? '' : ' '}${num}${sep}${renderInline(n.args[0], ctx)}</div>`);
  },
  includegraphics,

  LaTeX: symbol('L<sup>A</sup>T<sub>E</sub>X'),
  TeX: symbol('T<sub>E</sub>X'),
  '\\': symbol('<br>'),
  newline: symbol('<br>'),
  par: () => block(''),
  '%': symbol('%'),
  '&': symbol('&amp;'),
  _: symbol('_'),
  '#': symbol('#'),
  $: symbol('$'),
  '{': symbol('{'),
  '}': symbol('}'),
  ' ': symbol(' '),
  ',': symbol(' '),
  ';': symbol(' '),
  quad: symbol(' '),
  // 伸びる空白は幅を再現できないので全角分の空きで代用
  hfill: symbol(' '),
  hfil: symbol(' '),
  hss: ignore,
  vfill: ignore,
  vfil: ignore,
  qquad: symbol('  '),
  ldots: symbol('…'),
  dots: symbol('…'),
  textbackslash: symbol('\\'),

  // レイアウト・プリアンブル系は無視
  documentclass: ignore,
  usepackage: ignore,
  pagestyle: ignore,
  thispagestyle: ignore,
  setlength: ignore,
  addtolength: ignore,
  setcounter: ignore,
  hyphenation: ignore,
  bibliographystyle: ignore,
  centering: ignore,
  noindent: ignore,
  indent: ignore,
  vspace: ignore,
  'vspace*': ignore,
  hspace: ignore,
  'hspace*': ignore,
  newpage: ignore,
  clearpage: ignore,
  smallskip: ignore,
  medskip: ignore,
  bigskip: ignore,
  item: ignore,
  onecolumn: ignore,
  twocolumn: ignore,
  // jsclasses の \today の表記切替。プレビューは常に西暦
  西暦: ignore,
  和暦: ignore,
};
