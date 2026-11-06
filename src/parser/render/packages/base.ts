import type { Node } from '../../parser';
import { renderBlocks, renderInline } from '../blocks';
import { refStepCounter } from '../numbering';
import { cssColor, SWITCH_NAMES } from '../switches';
import { escapeHtml, plain, renderText } from '../text';
import { TOC_MARK } from './toc';
import { block, CommandDef, CommandHandler, Ctx, EnvHandler, ignore, inline, NOTHING, Package } from '../types';

const one = (render: CommandHandler): CommandDef => ({ args: 1, render });

const wrap = (tag: string, cls?: string): CommandDef =>
  one((n, ctx) => inline(`<${tag}${cls ? ` class="${cls}"` : ''}>${renderInline(n.args[0], ctx)}</${tag}>`));

/**
 * 見出し。counter は採番に使うカウンタ。
 * article 系の既定（secnumdepth=3）に合わせ、subsubsection より下と * 付きは番号なし
 */
const heading = (level: number, counter?: string): CommandDef => one((n, ctx) => {
  let num = '';
  let numbered = '';
  if (counter && !n.name.endsWith('*')) {
    numbered = refStepCounter(ctx, counter);
    num = `<span class="secnum">${numbered}</span>`;
  }
  const title = renderInline(n.args[0], ctx);
  if (numbered) {
    ctx.toc.push({ level, num: numbered, html: title });
  }
  return block(`<h${level} data-line="${n.line}">${num}${title || '&nbsp;'}</h${level}>`);
});

/** 文字を出すだけのコマンド（\ss{} のように後ろに {} を付けて空白を区切る書き方にも対応） */
const SYMBOLS: Record<string, string> = {
  ss: 'ß', SS: 'SS', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł',
  i: 'ı', j: 'ȷ', copyright: '©', S: '§', P: '¶', pounds: '£', dag: '†', ddag: '‡',
  textregistered: '®', texttrademark: '™', textasciitilde: '~', textasciicircum: '^', textbar: '|',
  textless: '&lt;', textgreater: '&gt;', textunderscore: '_', textemdash: '—', textendash: '–',
  textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  textdegree: '°', textellipsis: '…', textbullet: '•', textperiodcentered: '·', euro: '€', texteuro: '€',
  guillemotleft: '«', guillemotright: '»', flqq: '«', frqq: '»', textdagger: '†', textdaggerdbl: '‡',
  textparagraph: '¶', textsection: '§', textcopyright: '©', textpm: '±', texttimes: '×', textdiv: '÷',
};

const symbol = (s: string): CommandHandler => () => inline(s);

/** 見つからないファイルの注記（文言は拡張機能側で表示言語に合わせて渡せる） */
export const notFound = (ctx: Ctx, files: string) => ctx.opts.notFound?.(files) ?? `${files} が見つかりません`;

const missingInput: CommandHandler = (n, ctx) => {
  const name = plain(n.args[0]).trim();
  const file = /\.[a-zA-Z0-9]+$/.test(name) ? name : `${name}.tex`;
  return block(`<p class="missing" data-line="${n.line}">${escapeHtml(notFound(ctx, file))}</p>`);
};

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
  html += `<div class="date">${date ? renderInline(date, ctx) : ctx.locale.today(ctx.wareki)}</div>`;
  return block(html + '</header>');
};

/** LaTeX 本体（article 系の文書クラス）が持つコマンドと環境 */
export const base: Package = {
  counters: {
    section: {},
    subsection: { within: 'section' },
    subsubsection: { within: 'subsection' },
    figure: {},
    table: {},
  },
  commands: {
    part: heading(1),
    chapter: heading(1),
    'part*': heading(1),
    'chapter*': heading(1),
    section: heading(2, 'section'),
    'section*': heading(2, 'section'),
    subsection: heading(3, 'subsection'),
    'subsection*': heading(3, 'subsection'),
    subsubsection: heading(4, 'subsubsection'),
    'subsubsection*': heading(4, 'subsubsection'),
    paragraph: heading(5),
    'paragraph*': heading(5),
    subparagraph: heading(6),
    'subparagraph*': heading(6),

    ...Object.fromEntries(SWITCH_NAMES.map((name) => [name, { args: 0, render: ignore } as CommandDef])),
    color: { args: 1, render: ignore },
    raggedright: { args: 0, render: ignore },
    raggedleft: { args: 0, render: ignore },
    textcolor: {
      args: 2,
      render: (n, ctx) => {
        const c = cssColor(n.opt, plain(n.args[0]));
        return inline(`<span${c ? ` style="color:${c}"` : ''}>${renderInline(n.args[1], ctx)}</span>`);
      },
    },
    colorbox: {
      args: 2,
      render: (n, ctx) => {
        const c = cssColor(n.opt, plain(n.args[0]));
        return inline(`<span${c ? ` style="background:${c}"` : ''}>${renderInline(n.args[1], ctx)}</span>`);
      },
    },
    textsuperscript: wrap('sup'),
    textsubscript: wrap('sub'),
    fbox: wrap('span', 'fbox'),
    framebox: wrap('span', 'fbox'),
    parbox: { args: 2, render: (n, ctx) => inline(`<span class="parbox">${renderInline(n.args[1], ctx)}</span>`) },
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
    footnote: one((n, ctx) => inline(`<span class="footnote">${renderInline(n.args[0], ctx)}</span>`)),
    url: one((n) => inline(`<code class="url">${escapeHtml(plain(n.args[0]))}</code>`)),
    href: { args: 2, render: (n, ctx) => inline(`<span class="link">${renderInline(n.args[1], ctx)}</span>`) },

    // 読み込めたファイルはパーサが中身に置き換えるので、ここに来るのは見つからなかったもの
    input: { args: 1, render: missingInput },
    include: { args: 1, render: missingInput },
    includeonly: one(ignore),

    maketitle: { args: 0, render: maketitle },
    title: one(ignore),
    author: one(ignore),
    date: one(ignore),
    today: { args: 0, render: (_, ctx) => inline(ctx.locale.today(ctx.wareki)) },
    and: symbol('<span class="and"></span>'),
    thanks: one((n, ctx) => inline(`<span class="footnote">${renderInline(n.args[0], ctx)}</span>`)),
    // 未定義のラベルは LaTeX と同じく ??
    ref: one((n, ctx) => inline(`<span class="ref">${ctx.labels.ref(plain(n.args[0]).trim())}</span>`)),
    eqref: one((n, ctx) => inline(`<span class="ref">(${ctx.labels.ref(plain(n.args[0]).trim())})</span>`)),
    pageref: () => inline('<span class="ref">??</span>'),
    label: one((n, ctx) => {
      ctx.labels.define(plain(n.args[0]).trim());
      return NOTHING;
    }),

    caption: one((n, ctx) => {
      if (!ctx.float) {
        return inline(renderInline(n.args[0], ctx));
      }
      const num = refStepCounter(ctx, ctx.float);
      const name = ctx.float === 'figure' ? ctx.locale.figureName : ctx.locale.tableName;
      return block(`<div class="caption" data-line="${n.line}">${ctx.locale.captionLabel(name, num)}${renderInline(n.args[0], ctx)}</div>`);
    }),

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
    ...Object.fromEntries(
      Object.entries(SYMBOLS).map(([name, s]) => [name, { args: 0, render: symbol(s) } as CommandDef])
    ),

    // レイアウト・プリアンブル系は無視
    documentclass: ignore,
    usepackage: ignore,
    pagestyle: ignore,
    thispagestyle: ignore,
    setlength: { args: 2, render: ignore },
    addtolength: { args: 2, render: ignore },
    setcounter: {
      args: 2,
      render: (n, ctx) => {
        ctx.counters.set(plain(n.args[0]).trim(), parseInt(plain(n.args[1]), 10) || 0);
        return NOTHING;
      },
    },
    addtocounter: {
      args: 2,
      render: (n, ctx) => {
        const name = plain(n.args[0]).trim();
        ctx.counters.set(name, ctx.counters.get(name) + (parseInt(plain(n.args[1]), 10) || 0));
        return NOTHING;
      },
    },
    hyphenation: one(ignore),
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
    tableofcontents: { args: 0, render: () => block(TOC_MARK) },
    appendix: {
      args: 0,
      render: (_, ctx) => {
        ctx.counters.reset('section');
        ctx.counters.useAlpha('section');
        return NOTHING;
      },
    },
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
      block(`<div class="abstract" data-line="${n.line}"><div class="abstract-title">${ctx.locale.abstractName}</div>${renderBlocks(n.children, ctx)}</div>`),
    minipage: { args: 1, render: container('minipage') },
  },
};
