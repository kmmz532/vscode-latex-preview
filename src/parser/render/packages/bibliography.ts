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
    return { entries, labels, keys: bibitems.map((b) => b.key), style };
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
  return { entries, labels, keys, style };
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

/**
 * スタイルの系統。書式の違いだけを見分ける
 * - plain：plain / unsrt / alpha / abbrv（BibTeX 標準）
 * - japanese：jplain / junsrt / jalpha / jabbrv（Vol. / No. / pp. と年で終わる。和文の書名は強調しない）
 * - ieee：ieeetr / IEEEtran（名は頭文字、題目は引用符、vol. / no. / pp.）
 */
type StyleFamily = 'plain' | 'japanese' | 'ieee';

function styleFamily(style: string): StyleFamily {
  if (/^j(plain|unsrt|alpha|abbrv)/i.test(style)) {
    return 'japanese';
  }
  if (/^(ieeetr|IEEEtran|ieee)/i.test(style)) {
    return 'ieee';
  }
  return 'plain';
}

/** 名を頭文字にする（Donald E. → D. E.）。abbrv 系と IEEE 系 */
function initials(first: string): string {
  return first
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split('-').map((p) => (/^[{\\]/.test(p) ? p : `${p[0]}.`)).join('-'))
    .join(' ');
}

/** BibTeX のスタイルに近い形で 1 件を整形する */
function formatEntry(e: BibEntry, ctx: Ctx): string {
  const f = e.fields;
  const family = styleFamily(ctx.bib.style);
  const abbreviate = family === 'ieee' || /abbrv/i.test(ctx.bib.style);
  const tex = (s: string | undefined) => (s ? renderInline(parseFragment(s), ctx).trim() : '');
  const isJa = (s: string | undefined) => !!s && CJK_NAME.test(s);
  const names = (s: string | undefined) => {
    const authors = splitAuthors(s);
    // 和文の名前は「姓 名」の順で、and を使わず読点相当のカンマで並べる（jplain 等と同じ）
    if (authors.some((a) => CJK_NAME.test(a.last + a.first))) {
      return authors.map((a) => tex(a.first ? `${a.last} ${a.first}` : a.last)).join(', ');
    }
    const list = authors.map((a) => {
      const first = abbreviate ? initials(a.first) : a.first;
      return tex(first ? `${first} ${a.last}` : a.last);
    });
    if (list.length <= 2) {
      return list.join(' and ');
    }
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  };
  // 書名・雑誌名の強調。jplain 系は和文の名前を強調しない
  const em = (s: string | undefined) => (family === 'japanese' && isJa(s) ? tex(s) : `<em>${tex(s)}</em>`);
  const pages = (p: string) => tex(p.replace(/-+/, '--'));
  const pp = (p: string) => (/[-,+]/.test(p) ? 'pp. ' : 'p. ') + pages(p);

  const parts: string[] = [];
  const authors = names(f.author) || (f.editor ? `${names(f.editor)}, editor${splitAuthors(f.editor).length > 1 ? 's' : ''}` : '');
  if (authors) {
    parts.push(authors);
  }
  const isBookLike = e.type === 'book' || e.type === 'proceedings' || e.type === 'phdthesis' || e.type === 'mastersthesis';
  if (f.title) {
    if (family === 'ieee' && !isBookLike) {
      // IEEE は題目を引用符で囲み、後ろの区切りは引用符の内側のカンマ
      parts.push(`“${tex(f.title)},”`);
    } else {
      parts.push(isBookLike ? em(f.title) : tex(f.title));
    }
  }

  const where: string[] = [];
  if (e.type === 'article') {
    if (f.journal) {
      where.push(em(f.journal));
    }
    if (family === 'plain') {
      // plain：Journal, 1(2):1--10
      let vol = '';
      if (f.volume) {
        vol = `${tex(f.volume)}${f.number ? `(${tex(f.number)})` : ''}`;
      }
      if (f.pages) {
        vol += `${f.volume ? ':' : ''}${pages(f.pages)}`;
      }
      if (vol) {
        where.push(vol);
      }
    } else {
      // jplain：Vol. 1, No. 2, pp. 1--10 / IEEE：vol. 1, no. 2, pp. 1--10
      const ieee = family === 'ieee';
      if (f.volume) {
        where.push(`${ieee ? 'vol.' : 'Vol.'}&nbsp;${tex(f.volume)}`);
      }
      if (f.number) {
        where.push(`${ieee ? 'no.' : 'No.'}&nbsp;${tex(f.number)}`);
      }
      if (f.pages) {
        where.push(pp(f.pages));
      }
    }
  } else if (e.type === 'inproceedings' || e.type === 'conference' || e.type === 'incollection') {
    if (f.booktitle) {
      where.push(`${family === 'ieee' ? 'in' : 'In'} ${em(f.booktitle)}`);
    }
    if (f.pages) {
      where.push(family === 'plain' ? `pages ${pages(f.pages)}` : pp(f.pages));
    }
  } else if (e.type === 'phdthesis' || e.type === 'mastersthesis') {
    where.push(e.type === 'phdthesis' ? 'PhD thesis' : "Master's thesis");
  }
  for (const k of ['school', 'institution', 'organization', 'publisher', 'address', 'howpublished'] as const) {
    if (f[k]) {
      where.push(tex(f[k]));
    }
  }
  // 和文の文献は月を付けず年だけ（jplain 系）
  const month = family === 'japanese' && isJa(f.title) ? undefined : f.month;
  const date = [month, f.year].filter(Boolean).map((s) => tex(s)).join(' ');
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
  // 各部を句点で区切る。IEEE は題目（引用符の内側のカンマ）以外をカンマでつなぎ、最後だけ句点
  const ends = (p: string) => /[.。,”]$/.test(p.replace(/<[^>]+>/g, ''));
  if (family === 'ieee') {
    return parts.map((p, i) => (ends(p) ? p : p + (i === parts.length - 1 ? '.' : ','))).join(' ');
  }
  return parts.map((p) => (ends(p) ? p : p + '.')).join(' ');
}
