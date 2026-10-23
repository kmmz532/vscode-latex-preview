import * as vscode from 'vscode';
import { IMAGE_EXTENSIONS, IMAGE_MIME } from './parser/graphics';
import type { DocumentResources, RenderOptions } from './parser/render';

/** これより大きい画像は読み込まない（更新のたびに Webview へ送るため） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * 文書が参照する .bib と画像を読み込み、変更を監視する。
 * 仮想ファイルシステムでも動くよう workspace.fs を使う
 */
export class ResourceLoader implements vscode.Disposable {
  /** 参照中の .bib と \input のファイル（変更を監視する対象） */
  private readonly bibUris = new Set<string>();
  private readonly inputUris = new Set<string>();
  /** 画像の data: URI（URI → 更新日時と中身） */
  private readonly imageCache = new Map<string, { mtime: number; dataUri: string }>();
  private readonly disposables: vscode.Disposable[] = [];

  /** onChange は参照中のファイルが変わったときに呼ぶ */
  constructor(onChange: () => void) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*.{bib,tex,${IMAGE_EXTENSIONS.join(',')}}`);
    // エディタで開いていない .bib や画像がディスク上で変わったとき。新しく置かれた画像は参照中か分からないので更新する
    const onFs = (uri: vscode.Uri) => {
      const key = uri.toString();
      if (this.bibUris.has(key) || this.inputUris.has(key) || this.imageCache.has(key) || /\.(png|jpe?g|gif|svg|webp)$/i.test(uri.path)) {
        onChange();
      }
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange(onFs),
      watcher.onDidCreate(onFs),
      watcher.onDidDelete(onFs),
      // 参照している .bib / \input のファイルをエディタで編集したとき
      vscode.workspace.onDidChangeTextDocument((e) => {
        const key = e.document.uri.toString();
        if (this.bibUris.has(key) || this.inputUris.has(key)) {
          onChange();
        }
      })
    );
  }

  /** 別の文書に切り替えたときに、前の文書の参照を忘れる */
  reset() {
    this.bibUris.clear();
    this.inputUris.clear();
    this.imageCache.clear();
  }

  /** documentUri を基準に参照ファイルを読み込む */
  async load(documentUri: vscode.Uri, resources: DocumentResources): Promise<Pick<RenderOptions, 'bibFiles' | 'images'>> {
    const dir = vscode.Uri.joinPath(documentUri, '..');
    const [bibFiles, images] = await Promise.all([this.readBibFiles(dir, resources), this.readImages(dir, resources)]);
    return { bibFiles, images };
  }

  /** 監視する \input のファイルを忘れる（読み直しの前に呼ぶ） */
  clearInputs() {
    this.inputUris.clear();
  }

  /**
   * \input / \include のファイルを読む（パスは LaTeX と同じく親の .tex のフォルダ基準）。
   * 拡張子がなければ .tex を補う。開いているものは未保存の内容を使い、見つからないものは含めない
   */
  async loadInputs(documentUri: vscode.Uri, names: string[]): Promise<Record<string, string>> {
    const dir = vscode.Uri.joinPath(documentUri, '..');
    const out: Record<string, string> = {};
    await Promise.all(
      names.map(async (name) => {
        const uri = vscode.Uri.joinPath(dir, /\.[a-zA-Z0-9]+$/.test(name) ? name : `${name}.tex`);
        this.inputUris.add(uri.toString());
        const text = await readText(uri);
        if (text !== undefined) {
          out[name] = text;
        }
      })
    );
    return out;
  }

  /**
   * \includegraphics の画像を読み、data: URI にする。
   * 更新日時が同じならキャッシュを使う。EPS / PDF など表示できないものは含めない
   */
  private async readImages(dir: vscode.Uri, { graphics, graphicsPaths }: DocumentResources): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const used = new Set<string>();
    await Promise.all(
      graphics.map(async (p) => {
        const hasExt = /\.[a-zA-Z0-9]+$/.test(p);
        const candidates: vscode.Uri[] = [];
        for (const d of ['', ...graphicsPaths]) {
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
  private async readBibFiles(dir: vscode.Uri, { bibliographies }: DocumentResources): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    this.bibUris.clear();
    await Promise.all(
      bibliographies.map(async (name) => {
        const uri = vscode.Uri.joinPath(dir, `${name}.bib`);
        this.bibUris.add(uri.toString());
        // 見つからない .bib はプレビュー側で「見つかりません」と表示する
        const text = await readText(uri);
        if (text !== undefined) {
          out[name] = text;
        }
      })
    );
    return out;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

/** テキストファイルを読む。エディタで開いているものは未保存の内容を使う。読めなければ undefined */
async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) {
    return open.getText();
  }
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
