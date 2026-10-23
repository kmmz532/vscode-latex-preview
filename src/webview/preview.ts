import katex from 'katex';
import type { FromWebview, ToWebview } from '../protocol';

declare function acquireVsCodeApi(): {
  postMessage(msg: FromWebview): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
};

interface ViewState {
  /** fit: 窓に収まるよう自動縮小 / manual: zoom の値で固定 */
  mode: 'fit' | 'manual';
  zoom: number;
}

const vscode = acquireVsCodeApi();
const content = document.getElementById('content')!;
let state: ViewState = { mode: 'fit', zoom: 1, ...vscode.getState() };
/** エディタとスクロールを同期するか（設定 latexPreview.scrollSync） */
let scrollSync = true;

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/**
 * 前回の更新で描画した数式（表示形式 + TeX → KaTeX の HTML）。
 * 編集で変わる数式はわずかなので、変わっていないものは KaTeX を呼ばずに使い回す。マクロが変わったら捨てる
 */
let mathCache = new Map<string, string>();
let mathCacheMacros = '';

/**
 * 1 回の更新で数式を描画するもの。render は要素ごとに何度呼んでもよく（ページ分割で使い回すブロックは描画しない）、
 * 最後に finish でキャッシュを今回使った数式だけに入れ替える（際限なく増えないように）
 */
function mathRenderer(macros: Record<string, string>) {
  const macrosKey = JSON.stringify(macros);
  const prev = macrosKey === mathCacheMacros ? mathCache : new Map<string, string>();
  const next = new Map<string, string>();
  const render = (root: Element) => {
    root.querySelectorAll<HTMLElement>('.math').forEach((el) => {
      const tex = el.textContent ?? '';
      const display = el.dataset.display === '1';
      const key = (display ? 'D' : 'I') + tex;
      const cached = prev.get(key) ?? next.get(key);
      if (cached !== undefined) {
        el.innerHTML = cached;
        next.set(key, cached);
        return;
      }
      try {
        katex.render(tex, el, {
          displayMode: display,
          throwOnError: false,
          strict: 'ignore',
          // \gdef 等で書き換えられても次の数式に影響しないよう毎回コピーする
          macros: { ...macros },
        });
        next.set(key, el.innerHTML);
      } catch (e) {
        el.classList.add('math-error');
        el.textContent = tex;
        el.title = String(e);
      }
    });
  };
  const finish = () => {
    mathCache = next;
    mathCacheMacros = macrosKey;
  };
  return { render, finish };
}

// ---- 表示言語 ----

/** ツールバーの文言。VS Code の表示言語（拡張機能が <html lang> に入れる）が日本語なら日本語にする */
const ja = document.documentElement.lang.startsWith('ja');
const t = {
  zoomOut: ja ? '縮小' : 'Zoom out',
  zoomIn: ja ? '拡大' : 'Zoom in',
  actualSize: ja ? '等倍' : 'Actual size',
  fit: ja ? '窓幅に合わせる' : 'Fit to window',
};

// ---- ズーム ----

const toolbar = document.createElement('div');
toolbar.className = 'toolbar';
const button = (label: string, title: string, onClick: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  toolbar.appendChild(b);
  return b;
};
button('−', t.zoomOut, () => stepZoom(-1));
const zoomLabel = document.createElement('span');
zoomLabel.className = 'zoom-label';
toolbar.appendChild(zoomLabel);
button('+', t.zoomIn, () => stepZoom(1));
const actual = button('100%', t.actualSize, () => setState({ mode: 'manual', zoom: 1 }));
const fit = button('', t.fit, () => setState({ mode: 'fit', zoom: state.zoom }));
// 両端の縦線へ向かう左右矢印（幅に合わせる）
fit.innerHTML =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2h1.5v12H1zM13.5 2H15v12h-1.5z"/>' +
  '<path d="M4 8l2.5-2.5v1.75h3V5.5L12 8l-2.5 2.5V8.75h-3v1.75z"/></svg>';
document.body.appendChild(toolbar);

function setState(next: Partial<ViewState>) {
  state = { ...state, ...next };
  vscode.setState(state);
  applyZoom();
}

function stepZoom(dir: 1 | -1) {
  const current = currentZoom();
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > current + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001);
  setState({ mode: 'manual', zoom: next ?? current });
}

/** Fit 時：紙面（\textwidth）が窓幅を超えるときだけ縮小する */
function fitZoom(): number {
  const page = content.querySelector<HTMLElement>('.doc');
  if (!page) {
    return 1;
  }
  // 拡大縮小（transform）の影響を受けない紙面幅
  const pageWidth = page.offsetWidth;
  const style = getComputedStyle(document.body);
  const available = document.documentElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return pageWidth > 0 && available < pageWidth ? Math.max(available / pageWidth, 0.2) : 1;
}

function currentZoom(): number {
  return state.mode === 'fit' ? fitZoom() : state.zoom;
}

/**
 * CSS の zoom は変えるたびに全ページのレイアウトを計算し直すので、transform で拡大縮小する。
 * 幅は 1/z にして窓幅に合わせ、縦は transform で増減した分を margin で詰める
 */
function applyZoom() {
  const z = currentZoom();
  content.style.width = `${100 / z}%`;
  content.style.transform = `scale(${z})`;
  content.style.marginBottom = `${content.offsetHeight * (z - 1)}px`;
  zoomLabel.textContent = `${Math.round(z * 100)}%`;
  fit.classList.toggle('active', state.mode === 'fit');
  actual.classList.toggle('active', state.mode === 'manual' && Math.abs(state.zoom - 1) < 0.001);
}

new ResizeObserver(() => {
  if (state.mode === 'fit') {
    applyZoom();
  }
}).observe(document.documentElement);

// ---- ページ分割 ----

/** ページに流し込むブロック */
interface Block {
  el: Element;
  two: boolean;
  /** 段組みの切替の先頭（改ページする） */
  segStart: boolean;
  /** 変わったかの判定用（data-line を除いた描画前の HTML） */
  key: string;
  /** 分割後の断片（el と、ページをまたいだ段落の続き） */
  pieces: Element[];
}

interface PageInfo {
  el: HTMLElement;
  /** 最初に入っているブロックの番号 */
  start: number;
  /** 最初のブロックが前のページからの続き */
  split: boolean;
  /** 最後に入っているブロックの番号 */
  end: number;
}

/** ページ分割の結果 */
interface Layout {
  /** ページを並べた .doc.paged（画面に出ているもの） */
  doc: HTMLElement;
  /** 文書クラスの寸法・マクロ。変わったら前回の分割は使えない */
  docKey: string;
  blocks: Block[];
  pages: PageInfo[];
}

/**
 * 前回のページ分割の結果。数千行の文書では全ページのレイアウト計算が重いので、
 * 次の更新では変わっていないページを DOM ごと画面に残し、変わったところだけ組み直す
 */
let layout: Layout | undefined;

/** .doc.paged の中身をブロックに分ける。数式を描画する前に呼ぶ（key に KaTeX の出力を含めない） */
function collectBlocks(doc: HTMLElement): Block[] {
  const blocks: Block[] = [];
  let prevTwo: boolean | undefined;
  for (const child of Array.from(doc.children)) {
    const two = child.classList.contains('twocolumn');
    const els = two ? Array.from(child.children) : [child];
    els.forEach((el, k) => {
      // 2 段組の塊は 1 つずつが別の区切り。1 段組は続くかぎりまとめる
      const segStart = k === 0 && (two || prevTwo !== false);
      blocks.push({ el, two, segStart, key: `${two ? 2 : 1}${segStart ? 's' : ''}${el.outerHTML.replace(/ data-line="\d*"/g, '')}`, pieces: [el] });
    });
    prevTwo = two;
  }
  return blocks;
}

/**
 * .doc.paged の中身を \textheight ごとのページに分ける。
 * ブロックを 1 つずつ入れ、あふれたら（2 段組なら 3 段目にはみ出したら）次のページへ送る。
 * 段落（<p>）はあふれた行の頭で分け、残りを次のページへ送る（段の間はブラウザが分割する）。
 * prev があれば、その doc の上で組み直す。先頭から変わっていないページと、
 * 変更箇所の後でページの始まりが前回と揃ったところから先は、前回のページをそのまま残す
 */
function paginate(doc: HTMLElement, blocks: Block[], docKey: string, renderMath: (el: Element) => void, prev?: Layout): Layout {
  const old = prev?.blocks ?? [];
  const n = blocks.length;
  const m = old.length;
  let same = 0;
  while (same < n && same < m && blocks[same].key === old[same].key) {
    same++;
  }
  let sameTail = 0;
  while (sameTail < Math.min(n, m) - same && blocks[n - 1 - sameTail].key === old[m - 1 - sameTail].key) {
    sameTail++;
  }

  // 最初に変わったブロックは、その前のブロックの最後の断片があるページに入る。そこより前のページは使い回す
  const oldPages = prev?.pages ?? [];
  const oldPageIndex = new Map(oldPages.map((p, k) => [p.el as Element, k]));
  /** 前回のブロックの断片のうち、q ページ目以降にあるもの */
  const piecesFrom = (b: Block, q: number) => b.pieces.filter((x) => (oldPageIndex.get(x.closest('.page')!) ?? -1) >= q);
  let r = same === 0 ? 0 : oldPages.findIndex((p) => p.end >= same - 1);
  if (r < 0) {
    r = oldPages.length;
  }
  const pages = oldPages.slice(0, r);
  const start = r < oldPages.length ? oldPages[r].start : pages.length > 0 ? pages[pages.length - 1].end + 1 : 0;
  for (let i = 0; i < start; i++) {
    reuseBlock(blocks[i], old[i]);
  }
  // r ページ目が段落の続きから始まるなら、その段落の残りの断片を 1 つにまとめて、そこから組み直す
  let tail: HTMLElement | undefined;
  if (r < oldPages.length && oldPages[r].split) {
    const rest = piecesFrom(old[start], r);
    reuseBlock(blocks[start], old[start]);
    tail = document.createElement('p');
    tail.className = 'split-tail';
    for (const x of rest) {
      tail.append(...Array.from(x.childNodes));
    }
    blocks[start].pieces = blocks[start].pieces.filter((x) => !rest.includes(x));
  }
  // 組み直すページはいったん末尾に足していき（途中に入れると後ろのページまで測り直しになり遅い）、
  // 最後に要らなくなった前回のページを外して、残す前回のページの手前へ移す
  if (!prev) {
    doc.replaceChildren();
  }
  let dropUntil = oldPages.length;
  const created: HTMLElement[] = [];

  const newPage = (i: number, split: boolean): HTMLElement => {
    const page = document.createElement('div');
    page.className = 'page';
    doc.appendChild(page);
    created.push(page);
    pages.push({ el: page, start: i, split, end: i });
    if (!blocks[i].two) {
      return page;
    }
    const cols = document.createElement('div');
    cols.className = 'twocolumn';
    page.appendChild(cols);
    return cols;
  };
  const shift = n - m;
  /** 前回の q ページ目以降を残し、ブロック from 以降を前回のものに差し替える */
  const adopt = (q: number, from: number) => {
    for (let j = from; j < n; j++) {
      reuseBlock(blocks[j], old[j - shift]);
    }
    for (const p of oldPages.slice(q)) {
      pages.push({ ...p, start: p.start + shift, end: p.end + shift });
    }
    dropUntil = q;
  };
  // 変更箇所より後で新しいページを始めるところで、前回も同じところからページが始まっていれば、以降は前回のまま
  const resync = (i: number): boolean => {
    const q = i < n - sameTail ? -1 : oldPages.findIndex((p) => p.start === i - shift && !p.split);
    if (q < 0) {
      return false;
    }
    adopt(q, i);
    return true;
  };
  // 段落の続き rest から始めるとき。前回も同じ文字から始まるページがあればそこにつなぐ
  const resyncTail = (i: number, b: Block, rest: Element): boolean => {
    if (i < n - sameTail) {
      return false;
    }
    const html = rest.innerHTML;
    const q = oldPages.findIndex(
      (p, k) =>
        p.start === i - shift &&
        p.split &&
        piecesFrom(old[i - shift], k)
          .map((x) => x.innerHTML)
          .join('') === html
    );
    if (q < 0) {
      return false;
    }
    const prevTail = piecesFrom(old[i - shift], q);
    reuseBlock({ ...b, el: rest }, { ...old[i - shift], pieces: prevTail });
    b.pieces.push(...prevTail);
    adopt(q, i + 1);
    return true;
  };

  let body: HTMLElement | undefined;
  if (tail) {
    body = newPage(start, true);
  }
  for (let i = start; i < n; i++) {
    const b = blocks[i];
    // \onecolumn / \twocolumn の切替は LaTeX と同じく改ページ
    if (!body || (b.segStart && !tail)) {
      if (resync(i)) {
        break;
      }
      body = newPage(i, false);
    }
    let block: Element | undefined = tail ?? b.el;
    if (tail) {
      b.pieces.push(tail);
      tail = undefined;
    } else {
      renderMath(b.el);
    }
    while (block) {
      body.appendChild(block);
      if (!overflows(body, b.two)) {
        break;
      }
      const rest = splitParagraph(block, body, b.two);
      if (rest) {
        pages[pages.length - 1].end = i;
        if (resyncTail(i, b, rest)) {
          body = undefined;
          break;
        }
        b.pieces.push(rest);
        body = newPage(i, true);
        block = rest;
        continue;
      }
      if (body.children.length > 1) {
        block.remove();
        if (resync(i)) {
          body = undefined;
          break;
        }
        body = newPage(i, false);
        body.appendChild(block);
      }
      break;
    }
    if (!body) {
      break;
    }
    pages[pages.length - 1].end = i;
  }
  for (const p of oldPages.slice(r, dropUntil)) {
    p.el.remove();
  }
  if (dropUntil < oldPages.length) {
    oldPages[dropUntil].el.before(...created);
  }
  return { doc, docKey, blocks, pages };
}

/** 前回分割したブロックの断片を今回のものとして使う（行番号だけ今回の値に直す） */
function reuseBlock(b: Block, prev: Block) {
  const lined = (els: Element[]) => els.flatMap((e) => [e, ...Array.from(e.querySelectorAll('[data-line]'))]).filter((e) => e.hasAttribute('data-line'));
  const from = lined([b.el]);
  const to = lined(prev.pieces);
  for (let k = 0; k < Math.min(from.length, to.length); k++) {
    to[k].setAttribute('data-line', from[k].getAttribute('data-line')!);
  }
  b.el = prev.el;
  b.pieces = prev.pieces;
}

/**
 * ページからあふれた段落を、最初にあふれた行の頭で 2 つに分ける。
 * 前半は block に残し、後半を新しい <p> にして返す。分けられなければ undefined
 */
function splitParagraph(block: Element, body: HTMLElement, two: boolean): HTMLElement | undefined {
  if (block.tagName !== 'P') {
    return undefined;
  }
  const box = body.getBoundingClientRect();
  // ページに収まるか：1 段組は下端、2 段組は 3 段目（右端より右）にはみ出していないか
  const fits = (r: DOMRect) => (two ? r.left < box.left + body.clientWidth - 1 : r.bottom <= box.top + body.clientHeight + 1);
  // 空白以外の文字の位置（文書順。fits は文書順に true → false と変わる）
  const chars: { node: Text; offset: number }[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) {
      if (!/\s/.test(node.data[i])) {
        chars.push({ node, offset: i });
      }
    }
  }
  const range = document.createRange();
  const charFits = (k: number) => {
    range.setStart(chars[k].node, chars[k].offset);
    range.setEnd(chars[k].node, chars[k].offset + 1);
    const r = range.getClientRects()[0];
    return !r || fits(r);
  };
  // 収まらない最初の文字を二分探索
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (charFits(mid)) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // 1 行も収まらない、または全部収まる（あふれの原因が別）なら分けない
  if (lo === 0 || lo >= chars.length) {
    return undefined;
  }
  const at = chars[lo];
  // 数式などの途中では切らず、その要素の手前で切る
  const atomic = at.node.parentElement?.closest('.math, code, .footnote, .cite, .ref');
  if (atomic && block.contains(atomic)) {
    range.setStartBefore(atomic);
  } else {
    range.setStart(at.node, at.offset);
  }
  range.setEnd(block, block.childNodes.length);
  const tail = range.extractContents();
  if (!tail.textContent?.trim() || !block.textContent?.trim()) {
    block.appendChild(tail);
    return undefined;
  }
  // 前半の最終行も両端揃えにし、後半は字下げしない（続きの段落）
  block.classList.add('split-head');
  const rest = document.createElement('p');
  rest.className = 'split-tail';
  rest.appendChild(tail);
  return rest;
}

function overflows(body: HTMLElement, two: boolean): boolean {
  return two ? body.scrollWidth > body.clientWidth + 1 : body.scrollHeight > body.clientHeight + 1;
}

// ---- スクロール同期 ----

/** プログラムからスクロールした直後は、その scroll イベントをエディタへ送り返さない */
let ignoreScrollUntil = 0;

/** data-line を持つ要素（文書順） */
function lineElements(): { line: number; el: HTMLElement }[] {
  return Array.from(content.querySelectorAll<HTMLElement>('[data-line]'))
    .map((el) => ({ line: parseInt(el.dataset.line ?? '', 10), el }))
    .filter((x) => !isNaN(x.line));
}

/** エディタの行に対応する要素までスクロールする */
function scrollToLine(line: number) {
  const items = lineElements();
  let target: HTMLElement | undefined;
  for (const it of items) {
    if (it.line > line) {
      break;
    }
    target = it.el;
  }
  ignoreScrollUntil = Date.now() + 200;
  if (!target) {
    window.scrollTo(0, 0);
    return;
  }
  window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - 8);
}

/** 画面上端にある要素の行。2 段組では上端をまたぐ要素のうち最も前の行 */
function topLine(): number | undefined {
  let best: number | undefined;
  let firstBelow: number | undefined;
  for (const { line, el } of lineElements()) {
    const r = el.getBoundingClientRect();
    if (r.top <= 8 && r.bottom > 8) {
      best = best === undefined ? line : Math.min(best, line);
    } else if (r.top > 8 && firstBelow === undefined) {
      firstBelow = line;
    }
  }
  return best ?? firstBelow;
}

let scrollTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('scroll', () => {
  if (!scrollSync || Date.now() < ignoreScrollUntil) {
    return;
  }
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const line = topLine();
    if (line !== undefined) {
      vscode.postMessage({ type: 'reveal', line });
    }
  }, 50);
});

// ダブルクリックでエディタのその行へ
content.addEventListener('dblclick', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
  if (el) {
    vscode.postMessage({ type: 'open', line: parseInt(el.dataset.line ?? '0', 10) });
  }
});

// ---- メッセージ ----

let updateVersion = 0;

window.addEventListener('message', async (event: MessageEvent<ToWebview>) => {
  const msg = event.data;
  if (msg.type === 'update') {
    const version = ++updateVersion;
    const scrollY = window.scrollY;
    // 画面に出す前に、画面外の要素で数式の描画と画像の読み込みを済ませる
    const fresh = document.createElement('div');
    fresh.innerHTML = msg.html;
    const docs = Array.from(fresh.querySelectorAll<HTMLElement>('.doc.paged'));
    const blocks = docs.map(collectBlocks);
    // ページ分割する文書の数式は、組み直すブロックだけ paginate で描画する
    const math = mathRenderer(msg.macros);
    for (const el of Array.from(fresh.children)) {
      if (!docs.includes(el as HTMLElement)) {
        math.render(el);
      }
    }
    // 画像の大きさが決まってからページ分割する
    await Promise.all(Array.from(fresh.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));
    if (version !== updateVersion) {
      return;
    }
    const macrosKey = JSON.stringify(msg.macros);
    const docKeys = docs.map((doc) => `${doc.className}|${doc.getAttribute('style')}|${macrosKey}`);
    // 前回と同じ 1 つの文書なら、画面のページを残したまま変わったところだけ組み直す
    const prev =
      docs.length === 1 && fresh.childElementCount === 1 && layout?.docKey === docKeys[0] && layout.doc.parentElement === content && content.childElementCount === 1
        ? layout
        : undefined;
    if (!prev) {
      content.replaceChildren(...Array.from(fresh.childNodes));
    }
    // ページ分割は等倍で測る（transform だけなのでレイアウトは計算し直さない）
    const transform = content.style.transform;
    content.style.transform = 'scale(1)';
    const results = docs.map((doc, k) => paginate(prev ? prev.doc : doc, blocks[k], docKeys[k], math.render, prev));
    math.finish();
    layout = results.length === 1 ? results[0] : undefined;
    content.style.transform = transform;
    // 段組みの有無で最小幅が変わるので再計算
    applyZoom();
    // 同期中はエディタの位置へ、そうでなければ元のスクロール位置を保つ
    if (scrollSync && typeof msg.line === 'number') {
      scrollToLine(msg.line);
    } else {
      ignoreScrollUntil = Date.now() + 200;
      window.scrollTo(0, scrollY);
    }
  } else if (msg.type === 'config') {
    scrollSync = msg.scrollSync;
  } else if (msg.type === 'scrollTo' && scrollSync) {
    scrollToLine(msg.line);
  }
});

setState({});
vscode.postMessage({ type: 'ready' });
