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
  /** エディタとスクロールを同期するか */
  sync: boolean;
}

const vscode = acquireVsCodeApi();
const content = document.getElementById('content')!;
let state: ViewState = { mode: 'fit', zoom: 1, sync: true, ...vscode.getState() };

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/**
 * 前回の更新で描画した数式（表示形式 + TeX → KaTeX の HTML）。
 * 編集で変わる数式はわずかなので、変わっていないものは KaTeX を呼ばずに使い回す。マクロが変わったら捨てる
 */
let mathCache = new Map<string, string>();
let mathCacheMacros = '';

function renderMath(root: HTMLElement, macros: Record<string, string>) {
  const macrosKey = JSON.stringify(macros);
  const prev = macrosKey === mathCacheMacros ? mathCache : new Map<string, string>();
  // 今回使った数式だけを残す（キャッシュが際限なく増えないように）
  const next = new Map<string, string>();
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
  mathCache = next;
  mathCacheMacros = macrosKey;
}

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
button('−', 'Zoom out', () => stepZoom(-1));
const zoomLabel = document.createElement('span');
zoomLabel.className = 'zoom-label';
toolbar.appendChild(zoomLabel);
button('+', 'Zoom in', () => stepZoom(1));
const actual = button('100%', 'Actual size', () => setState({ mode: 'manual', zoom: 1 }));
const fit = button('', 'Fit to window', () => setState({ mode: 'fit', zoom: state.zoom }));
// 両端の縦線へ向かう左右矢印（幅に合わせる）
fit.innerHTML =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2h1.5v12H1zM13.5 2H15v12h-1.5z"/>' +
  '<path d="M4 8l2.5-2.5v1.75h3V5.5L12 8l-2.5 2.5V8.75h-3v1.75z"/></svg>';
const syncButton = button('', 'Sync scroll with editor', () => setState({ sync: !state.sync }));
// 鎖のアイコン（エディタと連動）
syncButton.innerHTML =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.9 9.1a.75.75 0 0 1 0-1.06l1.13-1.13a.75.75 0 1 1 1.06 1.06L7.96 9.1a.75.75 0 0 1-1.06 0z"/>' +
  '<path d="M4.4 8.5 3.3 9.6a2.25 2.25 0 0 0 3.18 3.18l1.1-1.1 1.07 1.06-1.1 1.1A3.75 3.75 0 0 1 2.24 8.54l1.1-1.1zM11.6 7.5l1.1-1.1a2.25 2.25 0 0 0-3.18-3.18l-1.1 1.1-1.07-1.06 1.1-1.1a3.75 3.75 0 0 1 5.3 5.3l-1.1 1.1z"/></svg>';
// 鍵のアイコン（このファイルに固定 / アクティブなエディタに追従）。状態は拡張機能側が持つ
const lockButton = button('', 'Lock preview to this file', () => vscode.postMessage({ type: 'toggleLock' }));
lockButton.innerHTML =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7V5a3 3 0 0 1 6 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm1.5 0h3V5a1.5 1.5 0 0 0-3 0z"/></svg>';
document.body.appendChild(toolbar);

function setState(next: Partial<ViewState>) {
  state = { ...state, ...next };
  vscode.setState(state);
  applyZoom();
  syncButton.classList.toggle('active', state.sync);
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
  // zoom の影響を受けない紙面幅を測る
  const prev = content.style.zoom;
  content.style.zoom = '1';
  const pageWidth = page.getBoundingClientRect().width;
  content.style.zoom = prev;
  const style = getComputedStyle(document.body);
  const available = document.documentElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return pageWidth > 0 && available < pageWidth ? Math.max(available / pageWidth, 0.2) : 1;
}

function currentZoom(): number {
  return state.mode === 'fit' ? fitZoom() : state.zoom;
}

function applyZoom() {
  const z = currentZoom();
  content.style.zoom = String(z);
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

/**
 * .doc.paged の中身を \textheight ごとのページに分ける。
 * ブロックを 1 つずつ入れ、あふれたら（2 段組なら 3 段目にはみ出したら）次のページへ送る。
 * 段落（<p>）はあふれた行の頭で分け、残りを次のページへ送る（段の間はブラウザが分割する）
 */
function paginate(doc: HTMLElement) {
  const segments: { two: boolean; blocks: Element[] }[] = [];
  for (const el of Array.from(doc.children)) {
    const two = el.classList.contains('twocolumn');
    const blocks = two ? Array.from(el.children) : [el];
    const last = segments[segments.length - 1];
    if (!two && last && !last.two) {
      last.blocks.push(...blocks);
    } else {
      segments.push({ two, blocks });
    }
  }
  doc.replaceChildren();

  // \onecolumn / \twocolumn の切替は LaTeX と同じく改ページ
  for (const seg of segments) {
    let body = newPage(doc, seg.two);
    for (const first of seg.blocks) {
      let block: Element | undefined = first;
      while (block) {
        body.appendChild(block);
        if (!overflows(body, seg.two)) {
          break;
        }
        const rest = splitParagraph(block, body, seg.two);
        if (rest) {
          body = newPage(doc, seg.two);
          block = rest;
          continue;
        }
        if (body.children.length > 1) {
          block.remove();
          body = newPage(doc, seg.two);
          body.appendChild(block);
        }
        break;
      }
    }
  }
}

function newPage(doc: HTMLElement, two: boolean): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page';
  doc.appendChild(page);
  if (!two) {
    return page;
  }
  const cols = document.createElement('div');
  cols.className = 'twocolumn';
  page.appendChild(cols);
  return cols;
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
  if (!state.sync || Date.now() < ignoreScrollUntil) {
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
    content.innerHTML = msg.html;
    renderMath(content, msg.macros);
    // 画像の大きさが決まってからページ分割する
    await Promise.all(Array.from(content.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));
    if (version !== updateVersion) {
      return;
    }
    // ページ分割は等倍で測る
    const zoom = content.style.zoom;
    content.style.zoom = '1';
    content.querySelectorAll<HTMLElement>('.doc.paged').forEach(paginate);
    content.style.zoom = zoom;
    // 段組みの有無で最小幅が変わるので再計算
    applyZoom();
    // 同期中はエディタの位置へ、そうでなければ元のスクロール位置を保つ
    if (state.sync && typeof msg.line === 'number') {
      scrollToLine(msg.line);
    } else {
      ignoreScrollUntil = Date.now() + 200;
      window.scrollTo(0, scrollY);
    }
  } else if (msg.type === 'locked') {
    lockButton.classList.toggle('active', msg.value);
    lockButton.title = msg.value ? 'Unlock preview (follow the active editor)' : 'Lock preview to this file';
  } else if (msg.type === 'scrollTo' && state.sync) {
    scrollToLine(msg.line);
  }
});

setState({});
vscode.postMessage({ type: 'ready' });
