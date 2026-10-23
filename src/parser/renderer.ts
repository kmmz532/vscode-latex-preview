import { BibEntry, parseBib, splitAuthors } from './bibtex';
import { computeLayout } from './docclass';
import { Node, parse, parseDocument } from './parser';

export interface RenderOptions {
  showUnknownCommands: boolean;
  /** \bibliography で指定された .bib の中身（ファイル名 → 内容）。読めなかったものは含まない */
  bibFiles?: Record<string, string>;
}

/** 文献リストの状態（描画前に文書全体を走査して作る） */
interface BibState {
  /** .bib のエントリ */
  entries: Map<string, BibEntry>;
  /** キー → 表示ラベル（1, 2, ... や Knu84） */
  labels: Map<string, string>;
  /** 文献リストに出すキー（並び順どおり） */
  keys: string[];
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
  counters: { figure: number; table: number; section: number[]; equation: number };
  /** \ref で引く番号（前回の描画パスで集めたもの。前方参照のため 2 回描画する） */
  labels: Map<string, string>;
  /** 今回の描画パスで集めた \label */
  collected: Map<string, string>;
  /** 直前に振られた番号（LaTeX の \@currentlabel） */
  currentLabel: string;
  /** 描画中の float 環境（\caption の番号付けに使う） */
  float?: 'figure' | 'table';
  bib: BibState;
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

export interface RenderResult {
  html: string;
  /** 文書中の \newcommand 等。数式の描画時に KaTeX へ渡す */
  macros: Record<string, string>;
}

export function renderDocument(src: string, opts: RenderOptions): RenderResult {
  let nodes: Node[];
  let macros: Record<string, string>;
  try {
    ({ nodes, macros } = parseDocument(src));
  } catch (e) {
    return { html: `<pre class="error">Parse error: ${escapeHtml(String(e))}</pre>`, macros: {} };
  }
  const layout = computeLayout(nodes, plain);
  const meta: Meta = {};
  collectMeta(nodes, meta);
  const bib = prepareBib(nodes, opts.bibFiles ?? {});
  // \begin{document} があればその中身だけを描画（プリアンブル自体は描画しない）
  const doc = nodes.find((n) => n.kind === 'env' && n.name === 'document');
  const body = doc && doc.kind === 'env' ? doc.children : nodes;
  const renderPass = (labels: Map<string, string>) => {
    const ctx: Ctx = {
      opts,
      meta,
      japanese: layout.japanese,
      counters: { figure: 0, table: 0, section: [0, 0, 0], equation: 0 },
      labels,
      collected: new Map(),
      currentLabel: '',
      bib,
    };
    return { html: renderColumns(body, layout.twoColumn, ctx), collected: ctx.collected };
  };
  // 1 回目で \label を集め、2 回目でその番号を使って \ref を埋める
  const first = renderPass(new Map());
  const inner = first.collected.size ? renderPass(first.collected).html : first.html;
  const style =
    `--fs:${layout.fontSize};--lh:${layout.lineHeight};--indent:${layout.parindent};` +
    `--textwidth:${layout.textwidth};--textheight:${layout.textheight};--colsep:${layout.columnsep}`;
  // \documentclass がある完全な文書だけページ分割する（断片はそのまま流す）
  const paged = nodes.some((n) => n.kind === 'command' && n.name === 'documentclass') ? ' paged' : '';
  const html = `<div class="doc ${layout.japanese ? 'ja' : 'en'}${paged}" style="${style}">${inner}</div>`;
  return { html, macros };
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
      return renderMath(n, ctx);
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

function renderMath(n: Extract<Node, { kind: 'math' }>, ctx: Ctx): Out {
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
    ctx.currentLabel = c.slice(0, depth + 1).join('.');
    num = `<span class="secnum">${ctx.currentLabel}</span>`;
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
  bibliography: (n, ctx) => {
    const names = plain(n.args[0]).split(',').map((s) => s.trim()).filter(Boolean);
    const missing = names.filter((f) => !(f.replace(/\.bib$/, '') in (ctx.opts.bibFiles ?? {})));
    const items = ctx.bib.keys
      .filter((k) => ctx.bib.entries.has(k))
      .map((k) => bibItem(ctx.bib.labels.get(k) ?? '?', formatEntry(ctx.bib.entries.get(k)!, ctx), k));
    const note = missing.length
      ? `<p class="bib-missing">${escapeHtml(missing.map((f) => f.replace(/\.bib$/, '') + '.bib').join(', '))} が見つかりません</p>`
      : '';
    return block(bibSection(n.line, items.join('') + note, ctx));
  },
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

// ---- tabular ----

interface Column {
  align: 'left' | 'center' | 'right';
  width?: string;
  /** 列の左側の縦線の本数 */
  borderLeft: number;
  borderRight: number;
}

/** 列指定（|l|c|r|, p{3cm}, *{3}{c}, @{} など）を解釈する */
function parseColSpec(spec: string): Column[] {
  // *{n}{...} を展開
  for (let k = 0; k < 10 && spec.includes('*{'); k++) {
    spec = spec.replace(/\*\{(\d+)\}\{([^{}]*)\}/g, (_, n, s) => s.repeat(parseInt(n, 10)));
  }
  const cols: Column[] = [];
  let pending = 0;
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    const readBraced = () => {
      if (spec[i + 1] !== '{') {
        return '';
      }
      let depth = 0;
      const start = i + 2;
      for (let j = i + 1; j < spec.length; j++) {
        if (spec[j] === '{') {
          depth++;
        } else if (spec[j] === '}' && --depth === 0) {
          i = j;
          return spec.slice(start, j);
        }
      }
      i = spec.length;
      return spec.slice(start);
    };
    if (c === '|') {
      // 列の後ろの | はその列の右線、先頭の | は最初の列の左線
      if (cols.length) {
        cols[cols.length - 1].borderRight++;
      } else {
        pending++;
      }
    } else if (c === 'l' || c === 'c' || c === 'r') {
      cols.push({ align: c === 'l' ? 'left' : c === 'c' ? 'center' : 'right', borderLeft: pending, borderRight: 0 });
      pending = 0;
    } else if (c === 'p' || c === 'm' || c === 'b' || c === 'X') {
      const w = c === 'X' ? undefined : readBraced();
      cols.push({ align: 'left', width: w ? toWidth(w) : undefined, borderLeft: pending, borderRight: 0 });
      pending = 0;
    } else if (c === '@' || c === '!' || c === '>' || c === '<') {
      readBraced();
    }
  }
  return cols;
}

function toWidth(w: string): string | undefined {
  const m = /^\s*(\d*\.?\d+)\s*(mm|cm|in|pt|em|ex)\s*$/.exec(w);
  if (m) {
    return `${m[1]}${m[2]}`;
  }
  const rel = /^\s*(\d*\.?\d+)?\s*\\(linewidth|textwidth|columnwidth|hsize)\s*$/.exec(w);
  return rel ? `${parseFloat(rel[1] ?? '1') * 100}%` : undefined;
}

interface Row {
  cells: Node[][];
  /** この行の上に引く横線の本数 */
  hlines: number;
}

/** 子ノードを \\ で行に、& でセルに分ける */
function splitRows(children: Node[]): Row[] {
  const rows: Row[] = [];
  let row: Row = { cells: [[]], hlines: 0 };
  const cell = () => row.cells[row.cells.length - 1];
  for (const n of children) {
    if (n.kind === 'command' && (n.name === '\\' || n.name === 'tabularnewline')) {
      rows.push(row);
      row = { cells: [[]], hlines: 0 };
    } else if (n.kind === 'command' && (n.name === 'hline' || n.name === 'toprule' || n.name === 'midrule' || n.name === 'bottomrule')) {
      row.hlines++;
    } else if (n.kind === 'command' && n.name === 'cline') {
      // 部分的な横線は省略
    } else if (n.kind === 'text' && n.value.includes('&')) {
      const parts = n.value.split('&');
      parts.forEach((p, k) => {
        if (k > 0) {
          row.cells.push([]);
        }
        if (p) {
          cell().push({ ...n, value: p });
        }
      });
    } else {
      cell().push(n);
    }
  }
  rows.push(row);
  return rows;
}

const isBlank = (nodes: Node[]) => nodes.every((n) => n.kind === 'text' && !n.value.trim());

const tabular: EnvHandler = (n, ctx) => {
  // tabular*{幅}{列指定} / tabularx{幅}{列指定}
  const spec = n.args[n.name === 'tabular' ? 0 : 1];
  const cols = parseColSpec(nodesToSource(spec));
  const rows = splitRows(n.children);
  // 最後の \\ の後ろは横線だけの行になるので、表の下線として扱う
  const last = rows[rows.length - 1];
  let bottom = 0;
  if (last && last.cells.length === 1 && isBlank(last.cells[0])) {
    bottom = last.hlines;
    rows.pop();
  }
  const border = (count: number) => (count >= 2 ? '3px double' : count === 1 ? '1px solid' : '');
  const trs = rows.map((r, ri) => {
    const nextHlines = ri + 1 < rows.length ? rows[ri + 1].hlines : bottom;
    let col = 0;
    const tds = r.cells.map((c) => {
      let span = 1;
      let col0 = cols[col];
      let content = c;
      let lastCol: Column | undefined;
      // \multicolumn{n}{spec}{content}：揃えと縦線は spec に従う
      const mc = c.filter((x) => !(x.kind === 'text' && !x.value.trim()));
      if (mc.length === 1 && mc[0].kind === 'command' && mc[0].name === 'multicolumn') {
        span = parseInt(plain(mc[0].args[0]), 10) || 1;
        col0 = lastCol = parseColSpec(nodesToSource(mc[0].args[1]))[0] ?? col0;
        content = mc[0].args[2] ?? [];
      } else {
        lastCol = cols[col + span - 1];
      }
      col += span;
      const style: string[] = [`text-align:${col0?.align ?? 'left'}`];
      if (col0?.width) {
        style.push(`width:${col0.width}`);
      }
      if (col0?.borderLeft) {
        style.push(`border-left:${border(col0.borderLeft)}`);
      }
      if (lastCol?.borderRight) {
        style.push(`border-right:${border(lastCol.borderRight)}`);
      }
      if (r.hlines) {
        style.push(`border-top:${border(r.hlines)}`);
      }
      if (nextHlines) {
        style.push(`border-bottom:${border(nextHlines)}`);
      }
      return `<td${span > 1 ? ` colspan="${span}"` : ''} style="${style.join(';')}">${renderInline(content, ctx).trim()}</td>`;
    });
    return `<tr>${tds.join('')}</tr>`;
  });
  return block(`<table class="tabular" data-line="${n.line}">${trs.join('')}</table>`);
};

/** ノードを TeX ソースに近い文字列に戻す（列指定の解釈用） */
function nodesToSource(nodes: Node[] | undefined): string {
  if (!nodes) {
    return '';
  }
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.value;
        case 'group':
          return `{${nodesToSource(n.children)}}`;
        case 'command':
          return '\\' + n.name + n.args.map((a) => `{${nodesToSource(a)}}`).join('');
        default:
          return '';
      }
    })
    .join('');
}

const ENVS: Record<string, EnvHandler> = {
  thebibliography: (n, ctx) => {
    // \bibitem[ラベル]{キー} ごとに分ける
    const items: { key: string; nodes: Node[] }[] = [];
    for (const c of n.children) {
      if (c.kind === 'command' && c.name === 'bibitem') {
        items.push({ key: plain(c.args[0]).trim(), nodes: [] });
      } else if (items.length) {
        items[items.length - 1].nodes.push(c);
      }
    }
    const html = items
      .map((it) => bibItem(ctx.bib.labels.get(it.key) ?? '?', renderInline(it.nodes, ctx).trim(), it.key))
      .join('');
    return block(bibSection(n.line, html, ctx));
  },
  tabular,
  'tabular*': tabular,
  tabularx: tabular,
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

// ---- 参考文献 ----

/** 引用順に並べるスタイル（それ以外は著者名順） */
const CITATION_ORDER_STYLES = /^(unsrt|junsrt|ieeetr|unsrtnat|splncs|jIEEEtran|IEEEtran|ieee)/i;

function walk(nodes: Node[], visit: (n: Node) => void) {
  for (const n of nodes) {
    visit(n);
    if (n.kind === 'group') {
      walk(n.children, visit);
    } else if (n.kind === 'command') {
      n.args.forEach((a) => walk(a, visit));
    } else if (n.kind === 'env') {
      n.args.forEach((a) => walk(a, visit));
      walk(n.children, visit);
    }
  }
}

/** 文書全体の \cite / \bibitem / \bibliographystyle を集めてラベルを決める */
function prepareBib(nodes: Node[], bibFiles: Record<string, string>): BibState {
  const entries = new Map<string, BibEntry>();
  for (const src of Object.values(bibFiles)) {
    for (const [k, e] of parseBib(src)) {
      entries.set(k, e);
    }
  }
  let style = 'plain';
  const cited: string[] = [];
  const bibitems: { key: string; label?: string }[] = [];
  let citeAll = false;
  walk(nodes, (n) => {
    if (n.kind !== 'command') {
      return;
    }
    if (n.name === 'bibliographystyle') {
      style = plain(n.args[0]).trim();
    } else if (n.name === 'cite' || n.name === 'citep' || n.name === 'citet' || n.name === 'nocite') {
      for (const k of plain(n.args[0]).split(',').map((s) => s.trim()).filter(Boolean)) {
        if (k === '*') {
          citeAll = true;
        } else if (!cited.includes(k)) {
          cited.push(k);
        }
      }
    } else if (n.name === 'bibitem') {
      bibitems.push({ key: plain(n.args[0]).trim(), label: n.opt });
    }
  });

  const labels = new Map<string, string>();
  // thebibliography があればその順番とラベルが優先
  if (bibitems.length) {
    bibitems.forEach((b, i) => labels.set(b.key, b.label ?? String(i + 1)));
    return { entries, labels, keys: bibitems.map((b) => b.key) };
  }

  let keys = cited.filter((k) => entries.has(k));
  if (citeAll) {
    keys = [...keys, ...[...entries.keys()].filter((k) => !keys.includes(k))];
  }
  if (!CITATION_ORDER_STYLES.test(style)) {
    keys.sort((a, b) => sortKey(entries.get(a)!).localeCompare(sortKey(entries.get(b)!)));
  }
  const alpha = /alpha/i.test(style);
  keys.forEach((k, i) => labels.set(k, alpha ? alphaLabel(entries.get(k)!) : String(i + 1)));
  return { entries, labels, keys };
}

function sortKey(e: BibEntry): string {
  const a = splitAuthors(e.fields.author ?? e.fields.editor)[0];
  return `${stripBraces(a?.last ?? e.key)} ${e.fields.year ?? ''} ${stripBraces(e.fields.title ?? '')}`.toLowerCase();
}

/** alpha スタイルのラベル（Knuth 1984 → Knu84、3 人以上は頭文字） */
function alphaLabel(e: BibEntry): string {
  const authors = splitAuthors(e.fields.author ?? e.fields.editor).map((a) => stripBraces(a.last));
  const year = (e.fields.year ?? '').slice(-2);
  const head = authors.length === 0 ? e.key.slice(0, 3) : authors.length === 1 ? authors[0].slice(0, 3) : authors.slice(0, 3).map((a) => a[0]).join('');
  return head + year;
}

function stripBraces(s: string): string {
  return s.replace(/[{}]/g, '');
}

function renderCite(n: Extract<Node, { kind: 'command' }>, ctx: Ctx): Out {
  const keys = plain(n.args[0]).split(',').map((s) => s.trim()).filter(Boolean);
  // 文献リストにないキーは LaTeX と同じく ?
  const labels = keys.map((k) => escapeHtml(ctx.bib.labels.get(k) ?? '?'));
  const note = n.opt ? `, ${renderText(n.opt)}` : '';
  return inline(`<span class="cite">[${labels.join(', ')}${note}]</span>`);
}

function bibSection(line: number, items: string, ctx: Ctx): string {
  // \refname は jsarticle 系で「参考文献」、article 系で References（番号なしの \section*）
  const title = ctx.japanese ? '参考文献' : 'References';
  return `<section class="bibliography" data-line="${line}"><h2>${title}</h2><div class="bib-list">${items}</div></section>`;
}

function bibItem(label: string, body: string, key: string): string {
  return `<div class="bibitem" title="${escapeHtml(key)}"><span class="bib-label">[${escapeHtml(label)}]</span><span class="bib-body">${body}</span></div>`;
}

const CJK_NAME = /[぀-ヿ㐀-鿿]/;

/** BibTeX の plain スタイルに近い形で 1 件を整形する */
function formatEntry(e: BibEntry, ctx: Ctx): string {
  const f = e.fields;
  const tex = (s: string | undefined) => (s ? renderInline(parse(s), ctx).trim() : '');
  const names = (s: string | undefined) => {
    const authors = splitAuthors(s);
    // 和文の名前は「姓 名」の順で、and を使わず読点相当のカンマで並べる（jplain 等と同じ）
    if (authors.some((a) => CJK_NAME.test(a.last + a.first))) {
      return authors.map((a) => tex(a.first ? `${a.last} ${a.first}` : a.last)).join(', ');
    }
    const list = authors.map((a) => tex(a.first ? `${a.first} ${a.last}` : a.last));
    if (list.length <= 2) {
      return list.join(' and ');
    }
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  };
  const parts: string[] = [];
  const authors = names(f.author) || (f.editor ? `${names(f.editor)}, editor${splitAuthors(f.editor).length > 1 ? 's' : ''}` : '');
  if (authors) {
    parts.push(authors);
  }
  const isBookLike = e.type === 'book' || e.type === 'proceedings' || e.type === 'phdthesis' || e.type === 'mastersthesis';
  if (f.title) {
    parts.push(isBookLike ? `<em>${tex(f.title)}</em>` : tex(f.title));
  }

  const where: string[] = [];
  if (e.type === 'article') {
    let journal = f.journal ? `<em>${tex(f.journal)}</em>` : '';
    if (f.volume) {
      journal += `${journal ? ', ' : ''}${tex(f.volume)}${f.number ? `(${tex(f.number)})` : ''}`;
    }
    if (f.pages) {
      journal += `${f.volume ? ':' : journal ? ', ' : ''}${tex(f.pages.replace(/-+/, '--'))}`;
    }
    if (journal) {
      where.push(journal);
    }
  } else if (e.type === 'inproceedings' || e.type === 'conference' || e.type === 'incollection') {
    if (f.booktitle) {
      where.push(`In <em>${tex(f.booktitle)}</em>`);
    }
    if (f.pages) {
      where.push(`pp. ${tex(f.pages.replace(/-+/, '--'))}`);
    }
  } else if (e.type === 'phdthesis' || e.type === 'mastersthesis') {
    where.push(e.type === 'phdthesis' ? 'PhD thesis' : "Master's thesis");
  }
  for (const k of ['school', 'institution', 'organization', 'publisher', 'address', 'howpublished'] as const) {
    if (f[k]) {
      where.push(tex(f[k]));
    }
  }
  const date = [f.month, f.year].filter(Boolean).map((s) => tex(s)).join(' ');
  if (date) {
    where.push(date);
  }
  if (where.length) {
    parts.push(where.join(', '));
  }
  if (f.url) {
    parts.push(`<code class="url">${escapeHtml(f.url)}</code>`);
  }
  if (f.note) {
    parts.push(tex(f.note));
  }
  return parts.map((p) => (/[.。]$/.test(p.replace(/<[^>]+>/g, '')) ? p : p + '.')).join(' ');
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
