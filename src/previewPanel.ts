import * as vscode from 'vscode';
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
        if (e.document === this.document) {
          this.scheduleUpdate();
        }
      }),
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

  private update() {
    const config = vscode.workspace.getConfiguration('latexPreview');
    let html: string;
    try {
      html = renderDocument(this.document.getText(), {
        showUnknownCommands: config.get<boolean>('showUnknownCommands', true),
      });
    } catch (e) {
      html = `<pre class="error">${String(e)}</pre>`;
    }
    void this.panel.webview.postMessage({ type: 'update', html });
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
