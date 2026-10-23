# 開発者向けドキュメント
Simple LaTeX Preview の開発、ビルド方法と、内部の仕組みをまとめたもの。

## 必要なもの
- Node.js 20 以上
- npm

## ビルド・動作確認
```bash
npm install
npm run compile-web      # 開発ビルド（dist/web）
npm run watch-web        # 変更を監視して自動ビルド
npm run run-in-browser   # ブラウザ版 VS Code で sample/ を開いて起動
```

- `run-in-browser` は [@vscode/test-web](https://github.com/microsoft/vscode-test-web) を使う。VS Code 本体は OS の一時フォルダに展開される
- コードを変更したら、ブラウザ側のコマンドパレットで `Developer: Reload Window` を実行すると反映される
- Webview 内のエラーは `Developer: Open Webview Developer Tools` で確認できる

本番ビルド（minify・ソースマップなし）は `npm run package-web`。

## ディレクトリ構成
```
src/
├── extension.ts        # エントリポイント（コマンド登録）
├── previewPanel.ts     # WebviewPanel の管理、変更監視とデバウンス
├── parser/
│   ├── tokenizer.ts    # ソースをトークンに分割（数式はここで TeX のまま切り出す）
│   ├── parser.ts       # トークンから AST を作る
│   ├── renderer.ts     # AST を HTML に変換
│   └── docclass.ts     # 文書クラスとプリアンブルから寸法を算出
└── webview/
    ├── preview.ts      # Webview 側（KaTeX 描画、ページ分割、ズーム）
    └── preview.css
esbuild.mjs             # dist/web に extension.js / preview.js と KaTeX の CSS・フォントを出力
```

## 仕組み
```
Extension Host (Web Worker)                    Webview
┌───────────────────────────┐   update(html)   ┌──────────────────┐
│ tokenizer → parser        │ ───────────────▶ │ KaTeX で数式描画  │
│ → renderer / docclass     │                  │ ページ分割・ズーム │
│   （HTML 文字列を生成）     │ ◀─────────────── │                  │
└───────────────────────────┘      ready       └──────────────────┘
```

1. エディタの変更を `onDidChangeTextDocument` で受け、デバウンス（既定 200ms）してから再描画する
2. パーサは Extension Host 側で動き、HTML 文字列を Webview に送る。数式部分は TeX ソースのまま `.math` 要素に入れる
3. Webview は受け取った HTML を差し替え、`.math` を KaTeX で描画し、`\documentclass` がある文書は `\textheight` ごとのページに分割する
4. Webview はスクリプトの読み込み後に `ready` を送り、それを受けて初回描画する

### 設計方針
- **壊れないこと**：未対応のコマンドや環境は例外にせず、薄い色でソースのまま表示する
- **Web で動くこと**：Node.js の API（`fs` など）は使わない。外部への通信もしない
- **見た目は文書クラスに寄せる**：文字サイズ・行送り・字下げ・本文幅は `docclass.ts` が `jsarticle` / `article` 系の既定値（近似）と `\setlength` から決め、CSS 変数で渡す
- 欧文フォントは KaTeX 同梱のフォント（Computer Modern 系）、和文は OS の明朝・ゴシックを使う

### コマンドや環境を追加するには
`src/parser/renderer.ts` の `COMMANDS`（コマンド）または `ENVS`（環境）にハンドラを追加する。
必須引数の数が決まっているコマンドは `src/parser/parser.ts` の `ARITY` / `ENV_ARITY` にも登録する（未登録だと後続の `{...}` をすべて引数として取る）。
