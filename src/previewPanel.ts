import * as vscode from 'vscode';
import { findBibliographyFiles } from './parser/bibtex';
import { renderDocument } from './parser/renderer';

export class PreviewPanel {
  private static readonly panels = new Map<string, PreviewPanel>();

  static show(context: vscode.ExtensionContext, document: vscode.TextDocument, column: vscode.ViewColumn) {
    const existing = PreviewPanel.panels.get(document.uri.toString());
    if (existing) {
      existing.panel.reveal(column, true);
      return;
    }
    PreviewPanel.panels.set(document.uri.toString(), new PreviewPanel(context, document, column));
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;
  /** 参照中の .bib（変更を監視する対象） */
  private readonly bibUris = new Set<string>();

  private constructor(context: vscode.ExtensionContext, private readonly document: vscode.TextDocument, column: vscode.ViewColumn) {
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'web');
    this.panel = vscode.window.createWebviewPanel(
      'latexPreview',
      `Preview ${basename(document.uri)}`,
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
      // エディタで開いていない .bib がディスク上で変わったとき
      (() => {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.bib');
        const onFs = (uri: vscode.Uri) => {
          if (this.bibUris.has(uri.toString())) {
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
        if (d === this.document) {
          this.panel.dispose();
        }
      })
    );
    // Webview のスクリプトが読み込まれてから初回描画する
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        this.update();
      }
    }, null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
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
    const bibFiles = await this.readBibFiles(src);
    if (version !== this.version) {
      return;
    }
    let result: { html: string; macros: Record<string, string> };
    try {
      result = renderDocument(src, {
        showUnknownCommands: config.get<boolean>('showUnknownCommands', true),
        bibFiles,
      });
    } catch (e) {
      result = { html: `<pre class="error">${String(e)}</pre>`, macros: {} };
    }
    void this.panel.webview.postMessage({ type: 'update', ...result });
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
    PreviewPanel.panels.delete(this.document.uri.toString());
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

function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? '';
}
