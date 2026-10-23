import { BibEntry, parseBib, splitAuthors } from '../../bibtex';
import type { Node } from '../../parser';
import { renderInline } from '../blocks';
import { parseFragment } from '../registry';
import { escapeHtml, plain, renderText, walk } from '../text';
import { BibState, block, CommandHandler, CommandNode, Ctx, EnvNode, ignore, inline, Out, Package } from '../types';

/** 引用コマンド（文献リストの収集にも使う） */
const CITE_COMMANDS = ['cite', 'citep', 'citet'];

/** cite と文献リスト（ibliography の .bib / thebibliography 環境） */
export const bibliography: Package = {
  commands: {
    ...Object.fromEntries(CITE_COMMANDS.map((c): [string, CommandHandler] => [c, renderCite])),
    nocite: ignore,
    bibliography: renderBibliography,
    bibliographystyle: ignore,
    bibitem: ignore,
  },
  environments: {
    thebibliography: { args: 1, render: renderTheBibliography },
  },
};

/** 引用順に並べるスタイル（それ以外は著者名順） */
const CITATION_ORDER_STYLES = /^(unsrt|junsrt|ieeetr|unsrtnat|splncs|jIEEEtran|IEEEtran|ieee)/i;

/** 文書全体の \cite / \bibitem / \bibliographystyle を集めてラベルを決める */
export function prepareBib(nodes: Node[], bibFiles: Record<string, string>): BibState {
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
    } else if (CITE_COMMANDS.includes(n.name) || n.name === 'nocite') {
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

/** \cite / \citep / \citet */
function renderCite(n: CommandNode, ctx: Ctx): Out {
  const keys = plain(n.args[0]).split(',').map((s) => s.trim()).filter(Boolean);
  // 文献リストにないキーは LaTeX と同じく ?
  const labels = keys.map((k) => escapeHtml(ctx.bib.labels.get(k) ?? '?'));
  const note = n.opt ? `, ${renderText(n.opt)}` : '';
  return inline(`<span class="cite">[${labels.join(', ')}${note}]</span>`);
}

/** \bibliography{a,b}：.bib から文献リストを作る */
function renderBibliography(n: CommandNode, ctx: Ctx): Out {
  const names = plain(n.args[0]).split(',').map((s) => s.trim()).filter(Boolean);
  const missing = names.filter((f) => !(f.replace(/\.bib$/, '') in (ctx.opts.bibFiles ?? {})));
  const items = ctx.bib.keys
    .filter((k) => ctx.bib.entries.has(k))
    .map((k) => bibItem(ctx.bib.labels.get(k) ?? '?', formatEntry(ctx.bib.entries.get(k)!, ctx), k));
  const note = missing.length
    ? `<p class="bib-missing">${escapeHtml(missing.map((f) => f.replace(/\.bib$/, '') + '.bib').join(', '))} が見つかりません</p>`
    : '';
  return block(bibSection(n.line, items.join('') + note, ctx));
}

/** thebibliography 環境 */
function renderTheBibliography(n: EnvNode, ctx: Ctx): Out {
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
}

function bibSection(line: number, items: string, ctx: Ctx): string {
  // \refname は jsarticle 系で「参考文献」、article 系で References（番号なしの \section*）
  const title = ctx.locale.refName;
  return `<section class="bibliography" data-line="${line}"><h2>${title}</h2><div class="bib-list">${items}</div></section>`;
}

function bibItem(label: string, body: string, key: string): string {
  return `<div class="bibitem" title="${escapeHtml(key)}"><span class="bib-label">[${escapeHtml(label)}]</span><span class="bib-body">${body}</span></div>`;
}

const CJK_NAME = /[぀-ヿ㐀-鿿]/;

/** BibTeX の plain スタイルに近い形で 1 件を整形する */
function formatEntry(e: BibEntry, ctx: Ctx): string {
  const f = e.fields;
  const tex = (s: string | undefined) => (s ? renderInline(parseFragment(s), ctx).trim() : '');
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
