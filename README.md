# Simple LaTeX Preview
LaTeXを簡易プレビューするVSCode拡張機能<br />
既存の拡張機能とは異なり、Web版（vscode.dev / github.dev）でも動作する

## 使い方
1. `.tex` ファイルを開く
2. エディタ右上のプレビューアイコン、またはコマンドパレットから `LaTeX Preview: Open Preview to the Side` を実行
3. 編集内容はリアルタイムに反映される

プレビュー右上のボタンで拡大/縮小（`−` / `+`）、等倍（`100%`）、窓幅に合わせる（Fit）を切り替えられる。

## 対応している記法
- 数式: `$...$` `\(...\)` `$$...$$` `\[...\]`、`equation` `align` `gather` `multline`（KaTeX で描画）
- 見出し: `\section` 〜 `\subsubsection`（自動採番）、`\paragraph`
- `\title` `\author` `\date` `\maketitle`
- 文字装飾: `\textbf` `\textit` `\emph` `\texttt` `\underline` など
- リスト: `itemize` `enumerate` `description`
- `figure` / `table` と `\caption`（画像はファイル名の枠で表示）
- `\cite` `\ref` の簡易表示
- 文書クラス（`jsarticle` / `article` 系）に合わせた文字サイズ・行送り・字下げ
- `twocolumn` による 2 段組と、`\textheight` に基づくページ分割
- プリアンブルの `\setlength`（`\textwidth` `\textheight` `\columnsep` `\parindent`）

未対応のコマンドはエラーにせず、薄い色でそのまま表示する。

## 設定
| 設定 | デフォルト | 備考 |
| --- | --- | --- |
| `latexPreview.debounceMs` | `200` | 編集からプレビュー更新までの待ち時間（ms） |
| `latexPreview.showUnknownCommands` | `true` | 未対応コマンドをソースのまま表示する |

## 制限
- 段落はページをまたいで分割しない
- 画像の読み込み、`tabular`、`\newcommand`、`\input` などは未対応
- 寸法のデフォルトは各文書クラスの近似値

## 開発
```bash
npm install
npm run compile-web
npm run run-in-browser   # ブラウザ版 VS Code で sample/ を開いて起動
```

## License
- MIT
