import * as vscode from 'vscode';
import { analyzeDocument, renderAnalysis, RenderResult } from './parser/render';
import type { FromWebview, ToWebview } from './protocol';
import { ResourceLoader } from './resourceLoader';

/** \input の入れ子をたどる深さの上限 */
const MAX_INPUT_DEPTH = 10;

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
  private readonly resources = new ResourceLoader(() => this.scheduleUpdate());

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
      this.resources,
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.document) {
          this.scheduleUpdate();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('latexPreview')) {
          this.postConfig();
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
          this.post({ type: 'scrollTo', line: e.visibleRanges[0].start.line });
        }
      })
    );
    this.panel.webview.onDidReceiveMessage((msg: FromWebview) => {
      switch (msg.type) {
        case 'ready':
          // Webview のスクリプトが読み込まれてから初回描画する
          this.post({ type: 'locked', value: this.locked });
          this.postConfig();
          void this.update();
          break;
        case 'toggleLock':
          this.setLocked(!this.locked);
          break;
        case 'reveal': {
          // プレビューのスクロールにエディタを追従させる
          const editor = this.editor();
          if (editor) {
            this.ignoreEditorScrollUntil = Date.now() + 300;
            const pos = new vscode.Position(Math.max(0, msg.line), 0);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
          }
          break;
        }
        case 'open': {
          // ダブルクリックした段落の行へ移動
          const pos = new vscode.Position(Math.max(0, msg.line), 0);
          void vscode.window.showTextDocument(this.document, {
            viewColumn: this.editor()?.viewColumn ?? vscode.ViewColumn.One,
            selection: new vscode.Range(pos, pos),
          });
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
    this.resources.reset();
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
    this.post({ type: 'locked', value: locked });
  }

  private scheduleUpdate() {
    clearTimeout(this.timer);
    const ms = vscode.workspace.getConfiguration('latexPreview').get<number>('debounceMs', 200);
    this.timer = setTimeout(() => this.update(), ms);
  }

  private async update() {
    // 参照ファイルの読み込み中に次の更新が始まったら古い結果は捨てる
    const version = ++this.version;
    const config = vscode.workspace.getConfiguration('latexPreview');
    const src = this.document.getText();
    // \input したファイルがさらに \input していることがあるので、新しいファイルが出なくなるまで読んでは解析し直す
    const inputs: Record<string, string> = {};
    const tried = new Set<string>();
    this.resources.clearInputs();
    let analysis = analyzeDocument(src, inputs);
    for (let depth = 0; depth < MAX_INPUT_DEPTH; depth++) {
      const names = analysis.resources.inputs.filter((n) => !tried.has(n));
      if (!names.length) {
        break;
      }
      names.forEach((n) => tried.add(n));
      Object.assign(inputs, await this.resources.loadInputs(this.document.uri, names));
      if (version !== this.version) {
        return;
      }
      analysis = analyzeDocument(src, inputs);
    }
    const loaded = await this.resources.load(this.document.uri, analysis.resources);
    if (version !== this.version) {
      return;
    }
    let result: RenderResult;
    try {
      result = renderAnalysis(analysis, {
        showUnknownCommands: config.get<boolean>('showUnknownCommands', true),
        paginate: config.get<boolean>('paginate', true),
        inputs,
        ...loaded,
      });
      // 設定のマクロは文書中の \newcommand で上書きできるよう先に置く
      result.macros = { ...normalizeMacros(config.get<Record<string, string>>('mathMacros', {})), ...result.macros };
    } catch (e) {
      result = { html: `<pre class="error">${String(e)}</pre>`, macros: {} };
    }
    // 描画後にエディタの表示位置へ合わせる
    this.post({ type: 'update', ...result, line: this.editor()?.visibleRanges[0]?.start.line });
  }

  /** Webview 側で使う設定を送る */
  private postConfig() {
    const config = vscode.workspace.getConfiguration('latexPreview');
    this.post({ type: 'config', scrollSync: config.get<boolean>('scrollSync', true) });
  }

  private post(msg: ToWebview) {
    void this.panel.webview.postMessage(msg);
  }

  private editor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((e) => e.document === this.document);
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

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/** 設定のマクロ名に \ がなければ補う（KaTeX は "\name" の形で受け取る） */
function normalizeMacros(macros: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, body] of Object.entries(macros ?? {})) {
    if (typeof body === 'string' && name) {
      out[name.startsWith('\\') ? name : `\\${name}`] = body;
    }
  }
  return out;
}

export function isLatex(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'latex' || /\.(tex|ltx)$/i.test(doc.uri.path);
}

function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? '';
}
