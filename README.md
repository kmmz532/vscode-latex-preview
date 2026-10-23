# Simple LaTeX Preview
English | [日本語](README.ja.md)

A lightweight LaTeX preview for VS Code.<br />
Unlike other LaTeX extensions, it also works in VS Code for the Web (vscode.dev / github.dev). No TeX installation is required.

- https://marketplace.visualstudio.com/items?itemName=kmmz1127.simple-latex-preview

## Usage
1. Open a `.tex` file
2. Click the preview icon at the top right of the editor, or run `LaTeX Preview: Open Preview to the Side` from the Command Palette
3. The preview updates as you type

Use the buttons at the top right of the preview to zoom out / in (`−` / `+`), show at actual size (`100%`), or fit to the window (Fit).

## Supported syntax
- Math: `$...$` `\(...\)` `$$...$$` `\[...\]`, `equation` `align` `gather` `multline` (rendered with KaTeX)
- Headings: `\section` to `\subsubsection` (numbered), `\paragraph`
- `\title` `\author` `\date` `\maketitle`
- Text styles: `\textbf` `\textit` `\emph` `\texttt` `\underline`, etc.
- Lists: `itemize` `enumerate` `description`
- `figure` / `table` with `\caption` (images are shown as a placeholder with the file name)
- Tables: `tabular` `tabular*` `tabularx` (`l` `c` `r` `p{width}`, vertical rules `|`, `\hline`, `\multicolumn`)
- Macros: `\newcommand` `\renewcommand` `\providecommand` `\def` (with arguments and default optional arguments; also usable inside math)
- Bibliography: `\bibliography` reads `.bib` files in the same folder as the `.tex` file; `\bibliographystyle` decides the order (citation order for `unsrt` / `junsrt`, by author otherwise; `alpha` labels). `thebibliography` / `\bibitem` and `\cite` / `\nocite` are also supported
- Basic display of `\ref`
- Font size, line spacing and indentation based on the document class (`jsarticle` / `article` families)
- Two-column layout with `twocolumn`, and page breaks based on `\textheight`
- `\setlength` in the preamble (`\textwidth` `\textheight` `\columnsep` `\parindent`)

Unsupported commands do not cause errors; they are shown as dimmed source text.

## Settings
| Setting | Default | Description |
| --- | --- | --- |
| `latexPreview.debounceMs` | `200` | Delay in milliseconds before the preview updates after an edit |
| `latexPreview.showUnknownCommands` | `true` | Show unsupported commands as dimmed source text |

## Limitations
- Paragraphs are not split across pages
- Image loading, `\input` / `\include`, `\cline`, `\multirow`, etc. are not supported
- `\def` with delimited parameters (e.g. `\def\foo#1.{...}`) is not supported
- Default dimensions are approximations of each document class
- Bibliography entries are formatted in a simplified `plain`-like style regardless of `\bibliographystyle`

## Bug reports and feature requests
- https://github.com/kmmz532/vscode-latex-preview/issues

For developers, see [docs/README.md](docs/README.md) (Japanese).

## License
- MIT
