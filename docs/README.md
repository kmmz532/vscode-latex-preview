# 開発者向けドキュメント
Simple LaTeX Preview の開発、ビルド方法と、内部の仕組みをまとめたもの。（English: [README.en.md](README.en.md)）

## 必要なもの
- Node.js 20 以上
- npm

## ビルド・動作確認
```bash
npm install
npm run compile-web      # 開発ビルド（dist/web）
npm run watch-web        # 変更を監視して自動ビルド
npm run run-in-browser   # ブラウザ版 VS Code で sample/ を開いて起動
npm test                 # レンダラのゴールデンテスト（期待値の更新は npm test -- --update）
```

- `run-in-browser` は [@vscode/test-web](https://github.com/microsoft/vscode-test-web) を使う。VS Code 本体は OS の一時フォルダに展開される
- コードを変更したら、ブラウザ側のコマンドパレットで `Developer: Reload Window` を実行すると反映される
- Webview 内のエラーは `Developer: Open Webview Developer Tools` で確認できる

本番ビルド（minify・ソースマップなし）は `npm run package-web`。

## ディレクトリ構成
```
src/
├── extension.ts          # エントリポイント（コマンド登録）
├── previewPanel.ts       # WebviewPanel の管理、変更監視とデバウンス、固定 / 追従
├── resourceLoader.ts     # .bib・画像・\input のファイルの読み込みと監視
├── protocol.ts           # 拡張機能と Webview のメッセージ
├── parser/
│   ├── tokenizer.ts      # ソースをトークンに分割（数式はここで TeX のまま切り出す）
│   ├── parser.ts         # トークンから AST を作る。マクロの展開と \input の差し込みもここ
│   ├── docclass.ts       # 文書クラスとプリアンブルから寸法を算出
│   ├── bibtex.ts         # 簡易 BibTeX パーサ
│   ├── graphics.ts       # 画像の拡張子と MIME タイプ
│   ├── inputs.ts         # \input / \include のキーの正規化
│   └── render/
│       ├── index.ts      # analyzeDocument / renderAnalysis（AST → HTML）
│       ├── blocks.ts     # ブロック文脈（段落、段組み）
│       ├── registry.ts   # パッケージを 1 つのコマンド・環境の表にまとめる
│       ├── resources.ts  # AST から外部ファイルへの参照を集める
│       ├── numbering.ts  # カウンタと \label / \ref
│       ├── locale.ts     # 文書クラスで変わる文言（Abstract / 概要 など）
│       ├── text.ts       # テキストのエスケープなど
│       ├── types.ts      # 共通の型（Package, Ctx, RenderOptions など）
│       └── packages/     # LaTeX のパッケージのように機能をまとめたもの
│           ├── base.ts          # 見出し・文字装飾・リスト・float・\maketitle など
│           ├── math.ts          # 数式環境
│           ├── verbatim.ts      # verbatim / lstlisting / minted
│           ├── tabular.ts       # tabular, tabularx
│           ├── graphicx.ts      # \includegraphics
│           └── bibliography.ts  # \cite, \bibliography, thebibliography
└── webview/
    ├── preview.ts        # Webview 側（KaTeX 描画、ページ分割、ズーム、スクロール同期）
    └── preview.css
test/
├── golden.mjs            # test/fixtures/*.tex を描画して *.html と比較
└── fixtures/
esbuild.mjs               # dist/web に extension.js / preview.js と KaTeX の CSS・フォントを出力
```

## 仕組み
```
Extension Host (Web Worker)                    Webview
┌─────────────────────────────┐  update(html)  ┌──────────────────┐
│ tokenizer → parser          │ ─────────────▶ │ KaTeX で数式描画  │
│ → render（packages）         │                │ ページ分割・ズーム │
│ ResourceLoader（.bib・画像…） │ ◀───────────── │                  │
└─────────────────────────────┘     ready     └──────────────────┘
```

1. エディタの変更を `onDidChangeTextDocument` で受け、デバウンス（既定 200ms）してから再描画する
2. パーサは Extension Host 側で動き、HTML 文字列を Webview に送る。数式部分は TeX ソースのまま `.math` 要素に入れる
3. 先に文書を解析（`analyzeDocument`）して、参照しているファイル（`.bib`・画像・`\input` / `\include`）を集める。`ResourceLoader` が `workspace.fs` で読み込み、そのあとで描画する（`renderAnalysis`）。読み込んだファイルがさらに `\input` していることがあるので、新しいファイルが出なくなるまで解析をやり直す（最大 10 段）
4. Webview は受け取った HTML を差し替え、`.math` を KaTeX で描画し、`\documentclass` がある文書は `\textheight` ごとのページに分割する。変わったページだけを組み直す
5. Webview はスクリプトの読み込み後に `ready` を送り、それを受けて初回描画する

### 設計方針
- **壊れないこと**：未対応のコマンドや環境は例外にせず、薄い色でソースのまま表示する
- **Web で動くこと**：Node.js の API（`fs` など）は使わない。外部への通信もしない
- **見た目は文書クラスに寄せる**：文字サイズ・行送り・字下げ・本文幅は `docclass.ts` が `jsarticle` / `article` 系の既定値（近似）と `\setlength` から決め、CSS 変数で渡す
- 欧文フォントは KaTeX 同梱のフォント（Computer Modern 系）、和文は OS の明朝・ゴシックを使う

### プレビューのパネル（追従と固定）
VS Code の Markdown プレビューと同じく 2 種類ある。アクティブな `.tex` に追従するパネルが 1 つ（dynamic）と、ファイルごとに固定したパネル（locked）。鍵ボタンはタブ右上（`latexPreview.lock` / `unlock`）にあり、拡張機能がフォーカスのあるパネルを覚えて、コンテキストキー `latexPreview.locked` でアイコンを切り替える。

### マクロ（`\newcommand` など）
- 本文中のマクロは `parser.ts` がトークンの段階で展開し、展開結果をその場に差し込む（再帰は 10000 回で打ち切り）
- 数式は TeX ソースのまま Webview に送るので、定義を `macros` として一緒に送り、KaTeX の `macros` オプションで展開させる。設定 `latexPreview.mathMacros` はその前に混ぜるので、文書中の定義が優先される

### コマンドや環境を追加するには
機能は LaTeX のパッケージのように、パッケージ（`src/parser/render/packages/*.ts`）にまとめてある。パッケージは構文（引数の数）と描画を一緒に定義し、パーサとレンダラの両方が参照する。

1. いずれかのパッケージの `commands` または `environments` にハンドラを追加する（新しいパッケージを作ってもよい）
   - `{ args: 2, render }` のように必須引数の数を決められる。`args` を省くと、後続の `{...}` をすべて引数として取る
   - `mathEnvironments` は中身を数式として KaTeX に渡す環境、`verbatimEnvironments` は中身を解釈しない環境
   - `counters` で採番に使うカウンタを宣言する
2. 新しいパッケージは `registry.ts` の `packages()` に足す。同じ名前を 2 つのパッケージで定義すると例外になる
3. `test/fixtures/*.tex` にケースを足し、`npm test -- --update` で期待値を作って差分を確認する

### 表示言語で変わる文言
- package.json の文言（コマンド名・設定）は `package.nls.json` / `package.nls.ja.json`
- 拡張機能のコード内の文言は `vscode.l10n.t()` で書き、訳を `l10n/bundle.l10n.ja.json` に置く
- Webview のツールバーのツールチップは、拡張機能が `vscode.env.language` を入れた `<html lang>` を見て切り替える
- レンダラ自身が出す注記（ファイルが見つかりません）は `RenderOptions.notFound` で外から渡す

## リリース
`npm run release`（`scripts/publish.mjs`）で、同じ `.vsix` を VS Code Marketplace と Open VSX に公開し、GitHub Release にも添付する。`npm run release -- patch` ならバージョンを上げてから公開する。
