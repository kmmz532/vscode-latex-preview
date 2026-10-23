import * as vscode from 'vscode';
import { findBibliographyFiles } from './parser/bibtex';
import { IMAGE_EXTENSIONS, IMAGE_MIME, findGraphics } from './parser/graphics';
import { renderDocument } from './parser/render';

/**
 * プレビューは VS Code の Markdown プレビューと同じく 2 種類。
 * - 追従（dynamic）：アクティブなエディタの .tex に表示を切り替える。1 つだけ
 * - ロック（locked）：特定のファイルに固定。ファイルごとに 1 つ。複数のファイルを並べて見たいとき用
 */
export class PreviewPanel {
  private static dynamicPanel: PreviewPanel | undefined;
  private static readonly lockedPanels = new Map<string, PreviewPanel>();

  static show(context: vscode.ExtensionContext, document: vscode.TextDocument, column: vscode.ViewColumn) {
    const locked = PreviewPanel.lockedPanels.get(document.uri.toString());
    if (locked) {
      locked.panel.reveal(column, true);
      return;
    }
    const follow = vscode.workspace.getConfiguration('latexPreview').get<boolean>('followActiveEditor', true);
    if (!follow) {
      // 追従しない設定ではファイルごとにロックしたプレビューを作る
      PreviewPanel.lockedPanels.set(document.uri.toString(), new PreviewPanel(context, document, column, true));
      return;
    }
    if (PreviewPanel.dynamicPanel) {
      PreviewPanel.dynamicPanel.setDocument(document);
      PreviewPanel.dynamicPanel.panel.reveal(column, true);
      return;
    }
    PreviewPanel.dynamicPanel = new PreviewPanel(context, document, column, false);
  }

  /** 追従するプレビューを、アクティブになった .tex に切り替える */
  static onActiveEditorChanged(editor: vscode.TextEditor | undefined) {
    const panel = PreviewPanel.dynamicPanel;
    if (!panel || !editor || !isLatex(editor.document) || editor.document === panel.document) {
      return;
    }
    panel.setDocument(editor.document);
  }

  private readonly panel: vscode.WebviewPanel;
  private document: vscode.TextDocument;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;
  /** プレビュー起点でエディタを動かした直後は、その反動のスクロール通知を無視する */
  private ignoreEditorScrollUntil = 0;
  /** 参照中の .bib（変更を監視する対象） */
  private readonly bibUris = new Set<string>();
  /** 画像の data: URI（URI → 更新日時と中身） */
  private readonly imageCache = new Map<string, { mtime: number; dataUri: string }>();

  private constructor(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    column: vscode.ViewColumn,
    private locked: boolean
  ) {
    this.document = document;
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'web');
    this.panel = vscode.window.createWebviewPanel(
      'latexPreview',
      this.title(),
      { viewColumn: column, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [mediaRoot], retainContextWhenHidden: true }
    );
    this.panel.webview.html = this.shellHtml(mediaRoot);

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        // 参照している .bib を編集したときも更新する
        if (e.document === this.document || this.bibUris.has(e.document.uri.toString())) {
          this.scheduleUpdate();
        }
      }),
      // エディタで開いていない .bib や画像がディスク上で変わったとき
      (() => {
        const watcher = vscode.workspace.createFileSystemWatcher(`**/*.{bib,${IMAGE_EXTENSIONS.join(',')}}`);
        const onFs = (uri: vscode.Uri) => {
          const key = uri.toString();
          if (this.bibUris.has(key) || this.imageCache.has(key) || /\.(png|jpe?g|gif|svg|webp)$/i.test(uri.path)) {
            this.scheduleUpdate();
          }
        };
        watcher.onDidChange(onFs);
        watcher.onDidCreate(onFs);
        watcher.onDidDelete(onFs);
        return watcher;
      })(),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('latexPreview')) {
          this.update();
        }
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        // 追従するプレビューは最後の表示のまま残す（Markdown プレビューと同じ）
        if (d === this.document && this.locked) {
          this.panel.dispose();
        }
      })
    );
    // エディタのスクロールをプレビューに伝える（同期の on/off は Webview 側で判断）
    this.disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor.document === this.document && Date.now() > this.ignoreEditorScrollUntil && e.visibleRanges.length) {
          void this.panel.webview.postMessage({ type: 'scrollTo', line: e.visibleRanges[0].start.line });
        }
      })
    );
    this.panel.webview.onDidReceiveMessage((msg) => {
      switch (msg?.type) {
        case 'ready':
          // Webview のスクリプトが読み込まれてから初回描画する
          void this.panel.webview.postMessage({ type: 'locked', value: this.locked });
          void this.update();
          break;
        case 'toggleLock':
          this.setLocked(!this.locked);
          break;
        case 'reveal': {
          // プレビューのスクロールにエディタを追従させる
          const editor = this.editor();
          if (editor && typeof msg.line === 'number') {
            this.ignoreEditorScrollUntil = Date.now() + 300;
            const pos = new vscode.Position(Math.max(0, msg.line), 0);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
          }
          break;
        }
        case 'open': {
          // ダブルクリックした段落の行へ移動
          if (typeof msg.line === 'number') {
            const pos = new vscode.Position(Math.max(0, msg.line), 0);
            void vscode.window.showTextDocument(this.document, {
              viewColumn: this.editor()?.viewColumn ?? vscode.ViewColumn.One,
              selection: new vscode.Range(pos, pos),
            });
          }
          break;
        }
      }
    }, null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private title(): string {
    return `${this.locked ? '[Locked] ' : ''}Preview ${basename(this.document.uri)}`;
  }

  /** 表示するファイルを差し替える（追従するプレビュー用） */
  private setDocument(document: vscode.TextDocument) {
    if (document === this.document) {
      return;
    }
    this.document = document;
    this.bibUris.clear();
    this.imageCache.clear();
    this.panel.title = this.title();
    void this.update();
  }

  private setLocked(locked: boolean) {
    const key = this.document.uri.toString();
    if (locked) {
      // 同じファイルのロック済みプレビューがあれば、そちらを残してこちらは閉じる
      const existing = PreviewPanel.lockedPanels.get(key);
      if (existing && existing !== this) {
        existing.panel.reveal(undefined, true);
        this.panel.dispose();
        return;
      }
      PreviewPanel.lockedPanels.set(key, this);
      if (PreviewPanel.dynamicPanel === this) {
        PreviewPanel.dynamicPanel = undefined;
      }
    } else {
      PreviewPanel.lockedPanels.delete(key);
      // 追従するプレビューは 1 つだけなので、既存のものは閉じて置き換える
      if (PreviewPanel.dynamicPanel && PreviewPanel.dynamicPanel !== this) {
        PreviewPanel.dynamicPanel.panel.dispose();
      }
      PreviewPanel.dynamicPanel = this;
      PreviewPanel.onActiveEditorChanged(vscode.window.activeTextEditor);
    }
    this.locked = locked;
    this.panel.title = this.title();
    void this.panel.webview.postMessage({ type: 'locked', value: locked });
  }

  private scheduleUpdate() {
    clearTimeout(this.timer);
    const ms = vscode.workspace.getConfiguration('latexPreview').get<number>('debounceMs', 200);
    this.timer = setTimeout(() => this.update(), ms);
  }

  private async update() {
    // .bib の読み込み中に次の更新が始まったら古い結果は捨てる
    const version = ++this.version;
    const config = vscode.workspace.getConfiguration('latexPreview');
    const src = this.document.getText();
    const [bibFiles, images] = await Promise.all([this.readBibFiles(src), this.readImages(src)]);
    if (version !== this.version) {
      return;
    }
    let result: { html: string; macros: Record<string, string> };
    try {
      result = renderDocument(src, {
        showUnknownCommands: config.get<boolean>('showUnknownCommands', true),
        bibFiles,
        images,
      });
    } catch (e) {
      result = { html: `<pre class="error">${String(e)}</pre>`, macros: {} };
    }
    // 描画後にエディタの表示位置へ合わせる
    const editor = this.editor();
    void this.panel.webview.postMessage({ type: 'update', ...result, line: editor?.visibleRanges[0]?.start.line });
  }

  private editor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((e) => e.document === this.document);
  }

  /**
   * \includegraphics の画像を読み、data: URI にする（仮想ファイルシステムでも動くよう workspace.fs を使う）。
   * 更新日時が同じならキャッシュを使う。EPS / PDF など表示できないものは含めない
   */
  private async readImages(src: string): Promise<Record<string, string>> {
    const dir = vscode.Uri.joinPath(this.document.uri, '..');
    const { paths, dirs } = findGraphics(src);
    const out: Record<string, string> = {};
    const used = new Set<string>();
    await Promise.all(
      paths.map(async (p) => {
        const hasExt = /\.[a-zA-Z0-9]+$/.test(p);
        const candidates: vscode.Uri[] = [];
        for (const d of ['', ...dirs]) {
          const base = vscode.Uri.joinPath(dir, d, p);
          if (hasExt) {
            candidates.push(base);
          } else {
            candidates.push(...IMAGE_EXTENSIONS.map((e) => base.with({ path: `${base.path}.${e}` })));
          }
        }
        for (const uri of candidates) {
          const ext = uri.path.split('.').pop()!.toLowerCase();
          let stat: vscode.FileStat;
          try {
            stat = await vscode.workspace.fs.stat(uri);
          } catch {
            continue;
          }
          // 最初に見つかったファイルで決める（EPS / PDF ならプレースホルダ）
          const mime = IMAGE_MIME[ext];
          if (!mime || stat.size > MAX_IMAGE_BYTES) {
            return;
          }
          const key = uri.toString();
          used.add(key);
          let cached = this.imageCache.get(key);
          if (!cached || cached.mtime !== stat.mtime) {
            const bytes = await vscode.workspace.fs.readFile(uri);
            cached = { mtime: stat.mtime, dataUri: `data:${mime};base64,${toBase64(bytes)}` };
            this.imageCache.set(key, cached);
          }
          out[p] = cached.dataUri;
          return;
        }
      })
    );
    // 参照されなくなった画像はキャッシュから捨てる
    for (const key of [...this.imageCache.keys()]) {
      if (!used.has(key)) {
        this.imageCache.delete(key);
      }
    }
    return out;
  }

  /** \bibliography{...} の .bib を .tex と同じフォルダから読む。開いているものは未保存の内容を使う */
  private async readBibFiles(src: string): Promise<Record<string, string>> {
    const dir = vscode.Uri.joinPath(this.document.uri, '..');
    const out: Record<string, string> = {};
    this.bibUris.clear();
    await Promise.all(
      findBibliographyFiles(src).map(async (name) => {
        const uri = vscode.Uri.joinPath(dir, `${name}.bib`);
        this.bibUris.add(uri.toString());
        const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (open) {
          out[name] = open.getText();
          return;
        }
        try {
          out[name] = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch {
          // 見つからない .bib はプレビュー側で「見つかりません」と表示する
        }
      })
    );
    return out;
  }

  private shellHtml(mediaRoot: vscode.Uri): string {
    const webview = this.panel.webview;
    const uri = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, p));
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('katex/katex.min.css')}">
<link rel="stylesheet" href="${uri('preview.css')}">
</head>
<body>
<main id="content"></main>
<script nonce="${nonce}" src="${uri('preview.js')}"></script>
</body>
</html>`;
  }

  private dispose() {
    clearTimeout(this.timer);
    if (PreviewPanel.dynamicPanel === this) {
      PreviewPanel.dynamicPanel = undefined;
    }
    if (PreviewPanel.lockedPanels.get(this.document.uri.toString()) === this) {
      PreviewPanel.lockedPanels.delete(this.document.uri.toString());
    }
    this.disposables.forEach((d) => d.dispose());
  }
}

/** これより大きい画像は読み込まない（更新のたびに Webview へ送るため） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

export function isLatex(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'latex' || /\.(tex|ltx)$/i.test(doc.uri.path);
}

function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? '';
}
