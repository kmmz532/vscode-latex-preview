import { computeLayout } from './docclass';
import { Node, parse } from './parser';

export interface RenderOptions {
  showUnknownCommands: boolean;
}

interface Meta {
  title?: Node[];
  author?: Node[];
  date?: Node[];
}

interface Ctx {
  opts: RenderOptions;
  meta: Meta;
  /** 日本語文書クラス（jsarticle 等）なら「図」「表」、それ以外は Figure / Table */
  japanese: boolean;
  counters: { figure: number; table: number; section: number[] };
  /** 描画中の float 環境（\caption の番号付けに使う） */
  float?: 'figure' | 'table';
}

/** ブロック要素かどうかを付けたレンダリング結果 */
interface Out {
  html: string;
  block: boolean;
}

type CommandHandler = (n: Extract<Node, { kind: 'command' }>, ctx: Ctx) => Out;
type EnvHandler = (n: Extract<Node, { kind: 'env' }>, ctx: Ctx) => Out;

const inline = (html: string): Out => ({ html, block: false });
const block = (html: string): Out => ({ html, block: true });
const NOTHING = inline('');

export function renderDocument(src: string, opts: RenderOptions): string {
  let nodes: Node[];
  try {
    nodes = parse(src);
  } catch (e) {
    return `<pre class="error">Parse error: ${escapeHtml(String(e))}</pre>`;
  }
  const layout = computeLayout(nodes, plain);
  const ctx: Ctx = { opts, meta: {}, japanese: layout.japanese, counters: { figure: 0, table: 0, section: [0, 0, 0] } };
  collectMeta(nodes, ctx.meta);
  // \begin{document} があればその中身だけを描画（プリアンブル自体は描画しない）
  const doc = nodes.find((n) => n.kind === 'env' && n.name === 'document');
  const body = doc && doc.kind === 'env' ? doc.children : nodes;
  const style =
    `--fs:${layout.fontSize};--lh:${layout.lineHeight};--indent:${layout.parindent};` +
    `--textwidth:${layout.textwidth};--textheight:${layout.textheight};--colsep:${layout.columnsep}`;
  // \documentclass がある完全な文書だけページ分割する（断片はそのまま流す）
  const paged = nodes.some((n) => n.kind === 'command' && n.name === 'documentclass') ? ' paged' : '';
  return `<div class="doc ${layout.japanese ? 'ja' : 'en'}${paged}" style="${style}">${renderColumns(body, layout.twoColumn, ctx)}</div>`;
}

/** \onecolumn / \twocolumn で区切って段組みごとにまとめる */
function renderColumns(nodes: Node[], twoColumn: boolean, ctx: Ctx): string {
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

function collectMeta(nodes: Node[], meta: Meta) {
  for (const n of nodes) {
    if (n.kind === 'command' && (n.name === 'title' || n.name === 'author' || n.name === 'date')) {
      meta[n.name] = n.args[0] ?? [];
    } else if (n.kind === 'env' && n.name === 'document') {
      collectMeta(n.children, meta);
    }
  }
}

/** ブロック文脈：インライン要素の連続を <p> でまとめる */
function renderBlocks(nodes: Node[], ctx: Ctx): string {
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

function renderInline(nodes: Node[] | undefined, ctx: Ctx): string {
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
      return renderMath(n.tex, n.display, n.env, n.line);
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

function renderMath(tex: string, display: boolean, env: string | undefined, line: number): Out {
  // align 等は KaTeX 側で環境ごと描画させる
  let src = tex;
  if (env && env !== 'displaymath' && env !== 'math' && !env.startsWith('equation')) {
    const name = env.startsWith('eqnarray') ? 'align' + (env.endsWith('*') ? '*' : '') : env;
    src = `\\begin{${name}}${tex}\\end{${name}}`;
  }
  const attr = `class="math" data-display="${display ? 1 : 0}"`;
  return display
    ? block(`<div ${attr} data-line="${line}">${escapeHtml(src)}</div>`)
    : inline(`<span ${attr}>${escapeHtml(src)}</span>`);
}

function renderText(s: string): string {
  return escapeHtml(
    s
      .replace(/---/g, '—')
      .replace(/--/g, '–')
      .replace(/``/g, '“')
      .replace(/''/g, '”')
      .replace(/`/g, '‘')
      .replace(/~/g, ' ')
  );
}

function renderUnknownCommand(n: Extract<Node, { kind: 'command' }>, ctx: Ctx): Out {
  const args = n.args.map((a) => renderInline(a, ctx));
  if (!ctx.opts.showUnknownCommands) {
    return inline(args.join(' '));
  }
  const opt = n.opt !== undefined ? `[${escapeHtml(n.opt)}]` : '';
  const shown = args.map((a) => `{${a}}`).join('');
  return inline(`<span class="unknown">\\${escapeHtml(n.name)}${opt}${shown}</span>`);
}

function renderUnknownEnv(n: Extract<Node, { kind: 'env' }>, ctx: Ctx): Out {
  const body = renderBlocks(n.children, ctx);
  if (!ctx.opts.showUnknownCommands) {
    return block(`<div data-line="${n.line}">${body}</div>`);
  }
  return block(
    `<div class="unknown-env" data-line="${n.line}"><div class="env-name">${escapeHtml(n.name)}</div>${body}</div>`
  );
}

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
    num = `<span class="secnum">${c.slice(0, depth + 1).join('.')}</span>`;
  }
  return block(`<h${level} data-line="${n.line}">${num}${renderInline(n.args[0], ctx) || '&nbsp;'}</h${level}>`);
};

const ignore: CommandHandler = () => NOTHING;
const symbol = (s: string): CommandHandler => () => inline(s);

const COMMANDS: Record<string, CommandHandler> = {
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

  cite: (n) => inline(`<span class="cite">[${escapeHtml(plain(n.args[0]))}]</span>`),
  ref: (n) => inline(`<span class="ref">${escapeHtml(plain(n.args[0]))}</span>`),
  eqref: (n) => inline(`<span class="ref">(${escapeHtml(plain(n.args[0]))})</span>`),
  label: ignore,
  bibliography: (n) =>
    block(`<div class="bibliography" data-line="${n.line}">参考文献: ${escapeHtml(plain(n.args[0]))}.bib</div>`),

  caption: (n, ctx) => {
    if (!ctx.float) {
      return inline(renderInline(n.args[0], ctx));
    }
    const num = ++ctx.counters[ctx.float];
    const name = ctx.float === 'figure' ? (ctx.japanese ? '図' : 'Figure') : ctx.japanese ? '表' : 'Table';
    const sep = ctx.japanese ? '　' : ': ';
    return block(`<div class="caption" data-line="${n.line}">${name}${ctx.japanese ? '' : ' '}${num}${sep}${renderInline(n.args[0], ctx)}</div>`);
  },
  includegraphics: (n) => {
    const file = plain(n.args[0]).trim();
    return block(`<div class="graphics" data-line="${n.line}">${file ? escapeHtml(file) : 'image'}</div>`);
  },

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

const ENVS: Record<string, EnvHandler> = {
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

function plain(nodes: Node[] | undefined): string {
  if (!nodes) {
    return '';
  }
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.value;
        case 'group':
          return plain(n.children);
        case 'command':
          return n.name.length === 1 ? n.name : '';
        default:
          return '';
      }
    })
    .join('');
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
