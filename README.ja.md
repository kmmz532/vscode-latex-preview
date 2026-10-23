# Simple LaTeX Preview
[English](README.md) | 日本語

LaTeXを簡易プレビューするVSCode拡張機能<br />
既存のLaTeX拡張機能とは異なり、Web版（vscode.dev / github.dev）でも動作する

- https://marketplace.visualstudio.com/items?itemName=kmmz1127.simple-latex-preview

![スクリーンショット](images/screenshot.png)

## 使い方
1. `.tex` ファイルを開く
2. エディタ右上のプレビューアイコン、またはコマンドパレットから `LaTeX Preview: Open Preview to the Side` を実行
3. 編集内容はリアルタイムに反映される

プレビュー右上のボタンで拡大/縮小（`−` / `+`）、等倍（`100%`）、窓幅に合わせる（Fit）、エディタとのスクロール同期のオン/オフ（鎖のアイコン）を切り替えられる。
プレビューをダブルクリックすると、エディタのその行へ移動する。

プレビューは選択中のタブの `.tex` に追従して切り替わる。鍵のアイコンで今のファイルに固定でき、その状態でもう一度プレビューを開くと新しいプレビューができるので、複数のファイルを並べて表示できる。

## 対応している記法
- 数式: `$...$` `\(...\)` `$$...$$` `\[...\]`、`equation` `align` `gather` `multline`（KaTeX で描画）
- 見出し: `\section` 〜 `\subsubsection`（自動採番）、`\paragraph`
- `\title` `\author` `\date` `\maketitle`
- 文字装飾: `\textbf` `\textit` `\emph` `\texttt` `\underline` など
- リスト: `itemize` `enumerate` `description`
- `figure` / `table` と `\caption`
- 画像: `\includegraphics` でワークスペース内の PNG / JPEG / SVG / GIF / WebP を表示（`width` `height` `scale` `angle`、`\graphicspath` に対応）。EPS / PDF はファイル名の枠で表示
- 表: `tabular` `tabular*` `tabularx`（`l` `c` `r` `p{幅}`、縦線 `|`、`\hline`、`\cline`、`\multicolumn`、`\multirow`）
- コード: `verbatim` `Verbatim` `lstlisting`（`caption` / `label` 対応）`minted`、文中の `\verb` / `\lstinline`（色分けはしない）
- マクロ: `\newcommand` `\renewcommand` `\providecommand` `\def`（引数・オプション引数の既定値に対応。数式中でも使える）
- 参考文献: `\bibliography` で `.tex` と同じフォルダの `.bib` を読み込む。`\bibliographystyle` で並び順を切り替え（`unsrt` / `junsrt` は引用順、それ以外は著者名順、`alpha` はラベル形式）。`thebibliography` / `\bibitem`、`\cite` / `\nocite` にも対応
- 数式番号: `equation` `align` `gather` `multline` に自動で番号を振る（`\nonumber` `\notag` `\tag` に対応）
- 相互参照: `\label` と `\ref` / `\eqref`（節・図・表・数式。後ろで定義したラベルも参照できる）
- 文書クラス（`jsarticle` / `article` 系）に合わせた文字サイズ・行送り・字下げ
- `twocolumn` による 2 段組と、`\textheight` に基づくページ分割
- プリアンブルの `\setlength`（`\textwidth` `\textheight` `\columnsep` `\parindent`）

未対応のコマンドはエラーにせず、薄い色でそのまま表示する。

## 設定
| 設定 | デフォルト | 備考 |
| --- | --- | --- |
| `latexPreview.debounceMs` | `200` | 編集からプレビュー更新までの待ち時間（ms） |
| `latexPreview.followActiveEditor` | `true` | 選択中のタブの `.tex` に追従する。`false` ならファイルごとに別のプレビューを開く |
| `latexPreview.showUnknownCommands` | `true` | 未対応コマンドをソースのまま表示する |

## 制限
- 段落はページをまたいで分割しない
- `\input` / `\include` は未対応
- EPS / PDF の画像は表示できない
- `\def` の区切り付きパラメータ（`\def\foo#1.{...}` など）は未対応
- 寸法のデフォルトは各文書クラスの近似値
- 参考文献の書式は `\bibliographystyle` によらず `plain` に近い簡易的なもの

## バグ報告、要望
- https://github.com/kmmz532/vscode-latex-preview/issues

開発者向けの情報は [docs/README.md](docs/README.md) を参照。

## License
- MIT
