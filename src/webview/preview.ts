import katex from 'katex';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
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
let state: ViewState = vscode.getState() ?? { mode: 'fit', zoom: 1 };

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function renderMath(root: HTMLElement, macros: Record<string, string>) {
  root.querySelectorAll<HTMLElement>('.math').forEach((el) => {
    const tex = el.textContent ?? '';
    try {
      katex.render(tex, el, {
        displayMode: el.dataset.display === '1',
        throwOnError: false,
        strict: 'ignore',
        // \gdef 等で書き換えられても次の数式に影響しないよう毎回コピーする
        macros: { ...macros },
      });
    } catch (e) {
      el.classList.add('math-error');
      el.textContent = tex;
      el.title = String(e);
    }
  });
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
document.body.appendChild(toolbar);

function setState(next: ViewState) {
  state = next;
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
 * 段落はページをまたいで分割しない（段の間はブラウザが分割する）
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
    for (const block of seg.blocks) {
      body.appendChild(block);
      if (overflows(body, seg.two) && body.children.length > 1) {
        block.remove();
        body = newPage(doc, seg.two);
        body.appendChild(block);
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

function overflows(body: HTMLElement, two: boolean): boolean {
  return two ? body.scrollWidth > body.clientWidth + 1 : body.scrollHeight > body.clientHeight + 1;
}

// ---- メッセージ ----

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'update') {
    content.innerHTML = msg.html;
    renderMath(content, msg.macros ?? {});
    // ページ分割は等倍で測る
    const zoom = content.style.zoom;
    content.style.zoom = '1';
    content.querySelectorAll<HTMLElement>('.doc.paged').forEach(paginate);
    content.style.zoom = zoom;
    // 段組みの有無で最小幅が変わるので再計算
    applyZoom();
  }
});

applyZoom();
vscode.postMessage({ type: 'ready' });
