import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';

export function activate(context: vscode.ExtensionContext) {
  const open = (column: vscode.ViewColumn) => (uri?: vscode.Uri) => {
    const editor = vscode.window.activeTextEditor;
    const target = uri ?? editor?.document.uri;
    if (!target) {
      return;
    }
    void vscode.workspace.openTextDocument(target).then((doc) => PreviewPanel.show(context, doc, column));
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('latexPreview.openPreview', open(vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('latexPreview.openPreviewToSide', open(vscode.ViewColumn.Beside)),
    // プレビューの「…」メニューから、この拡張機能の設定だけを開く
    vscode.commands.registerCommand('latexPreview.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)
    ),
    vscode.window.onDidChangeActiveTextEditor((e) => PreviewPanel.onActiveEditorChanged(e))
  );
}

export function deactivate() {}
