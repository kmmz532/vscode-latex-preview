import type { Node } from '../../parser';
import { renderBlocks, renderInline } from '../blocks';
import { escapeHtml, plain, renderText, today } from '../text';
import { block, CommandHandler, EnvHandler, ignore, inline, NOTHING, Package } from '../types';

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

const symbol = (s: string): CommandHandler => () => inline(s);

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

const maketitle: CommandHandler = (n, ctx) => {
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
};

/** LaTeX 本体（article 系の文書クラス）が持つコマンドと環境 */
export const base: Package = {
  commands: {
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
    href: { args: 2, render: (n, ctx) => inline(`<span class="link">${renderInline(n.args[1], ctx)}</span>`) },

    maketitle: { args: 0, render: maketitle },
    title: ignore,
    author: ignore,
    date: ignore,
    today: { args: 0, render: () => inline(today()) },
    and: symbol('<span class="and"></span>'),
    thanks: (n, ctx) => inline(`<span class="footnote">${renderInline(n.args[0], ctx)}</span>`),

    // 未定義のラベルは LaTeX と同じく ??
    ref: (n, ctx) => inline(`<span class="ref">${escapeHtml(ctx.labels.get(plain(n.args[0]).trim()) ?? '??')}</span>`),
    eqref: (n, ctx) => inline(`<span class="ref">(${escapeHtml(ctx.labels.get(plain(n.args[0]).trim()) ?? '??')})</span>`),
    pageref: () => inline('<span class="ref">??</span>'),
    label: (n, ctx) => {
      ctx.collected.set(plain(n.args[0]).trim(), ctx.currentLabel);
      return NOTHING;
    },

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

    LaTeX: { args: 0, render: symbol('L<sup>A</sup>T<sub>E</sub>X') },
    TeX: { args: 0, render: symbol('T<sub>E</sub>X') },
    '\\': { args: 0, render: symbol('<br>') },
    newline: symbol('<br>'),
    par: { args: 0, render: () => block('') },
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
    setlength: { args: 2, render: ignore },
    addtolength: { args: 2, render: ignore },
    setcounter: { args: 2, render: ignore },
    hyphenation: ignore,
    centering: { args: 0, render: ignore },
    noindent: { args: 0, render: ignore },
    indent: ignore,
    vspace: ignore,
    'vspace*': ignore,
    hspace: ignore,
    'hspace*': ignore,
    newpage: { args: 0, render: ignore },
    clearpage: { args: 0, render: ignore },
    smallskip: ignore,
    medskip: ignore,
    bigskip: ignore,
    item: { args: 0, render: ignore },
    onecolumn: { args: 0, render: ignore },
    twocolumn: { args: 0, render: ignore },
    // jsclasses の \today の表記切替。プレビューは常に西暦
    西暦: ignore,
    和暦: ignore,
    tableofcontents: { args: 0 },
  },
  environments: {
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
    minipage: { args: 1 },
  },
};
