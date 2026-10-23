# Developer documentation
How to build Simple LaTeX Preview, and how it works inside. (日本語版: [README.md](README.md))

## Requirements
- Node.js 20 or later
- npm

## Build and try it
```bash
npm install
npm run compile-web      # development build (dist/web)
npm run watch-web        # rebuild on change
npm run run-in-browser   # start VS Code for the Web with sample/ opened
npm test                 # golden tests for the renderer (npm test -- --update rewrites the expected files)
```

- `run-in-browser` uses [@vscode/test-web](https://github.com/microsoft/vscode-test-web). VS Code itself is extracted into the OS temp folder
- After changing the code, run `Developer: Reload Window` from the browser's Command Palette
- Errors inside the webview can be inspected with `Developer: Open Webview Developer Tools`

The production build (minified, no source maps) is `npm run package-web`.

## Directory layout
```
src/
├── extension.ts          # entry point (command registration)
├── previewPanel.ts       # WebviewPanel management, change watching, debounce, lock / follow
├── resourceLoader.ts     # reads and watches .bib / images / \input files
├── protocol.ts           # messages between the extension and the webview
├── parser/
│   ├── tokenizer.ts      # splits the source into tokens (math is cut out as raw TeX here)
│   ├── parser.ts         # builds the AST; expands macros and inserts \input files
│   ├── docclass.ts       # derives dimensions from the document class and the preamble
│   ├── bibtex.ts         # simple BibTeX parser
│   ├── graphics.ts       # image extensions and MIME types
│   ├── inputs.ts         # key normalization for \input / \include
│   └── render/
│       ├── index.ts      # analyzeDocument / renderAnalysis (AST → HTML)
│       ├── blocks.ts     # block context: paragraphs, columns
│       ├── registry.ts   # merges all packages into one command / environment table
│       ├── resources.ts  # collects references to external files from the AST
│       ├── numbering.ts  # counters and \label / \ref
│       ├── locale.ts     # strings that depend on the document class (Abstract / 概要 ...)
│       ├── text.ts       # text escaping and helpers
│       ├── types.ts      # shared types (Package, Ctx, RenderOptions ...)
│       └── packages/     # features grouped like LaTeX packages
│           ├── base.ts          # sections, text styles, lists, floats, \maketitle ...
│           ├── math.ts          # math environments
│           ├── verbatim.ts      # verbatim / lstlisting / minted
│           ├── tabular.ts       # tabular, tabularx
│           ├── graphicx.ts      # \includegraphics
│           └── bibliography.ts  # \cite, \bibliography, thebibliography
└── webview/
    ├── preview.ts        # webview side (KaTeX, pagination, zoom, scroll sync)
    └── preview.css
test/
├── golden.mjs            # renders test/fixtures/*.tex and compares with *.html
└── fixtures/
esbuild.mjs               # writes extension.js / preview.js and KaTeX's CSS and fonts to dist/web
```

## How it works
```
Extension Host (Web Worker)                      Webview
┌─────────────────────────────┐   update(html)   ┌────────────────────────┐
│ tokenizer → parser          │ ───────────────▶ │ render math with KaTeX │
│ → render (packages)         │                  │ paginate, zoom, sync   │
│ ResourceLoader (.bib, img…) │ ◀─────────────── │                        │
└─────────────────────────────┘      ready       └────────────────────────┘
```

1. Editor changes arrive through `onDidChangeTextDocument` and are debounced (200 ms by default) before re-rendering
2. The parser runs on the extension host and sends an HTML string to the webview. Math stays as raw TeX inside `.math` elements
3. The document is analyzed first (`analyzeDocument`) to find the files it refers to (`.bib`, images, `\input` / `\include`). `ResourceLoader` reads them through `workspace.fs`, then the document is rendered (`renderAnalysis`). Because an included file may itself `\input` other files, the analysis is repeated until no new file appears (up to 10 levels)
4. The webview swaps in the HTML, renders `.math` with KaTeX, and for documents with `\documentclass` splits the content into pages of `\textheight`. Only the pages that changed are rebuilt
5. The webview sends `ready` once its script has loaded, and the first render starts then

### Design principles
- **Never break**: unsupported commands and environments are not errors. They are shown dimmed, as the original source
- **Work on the web**: no Node.js APIs (`fs` etc.) and no network access
- **Look like the document class**: font size, line height, indentation and text width come from `docclass.ts` (approximations of `jsarticle` / `article`) and `\setlength`, and are passed to CSS as variables
- Latin text uses the fonts bundled with KaTeX (Computer Modern family); Japanese text uses the OS's Mincho / Gothic fonts

### Preview panels (follow and lock)
Like VS Code's Markdown preview there are two kinds: one *dynamic* panel that follows the active `.tex` editor, and *locked* panels fixed to one file each. The lock button is in the tab's title bar (`latexPreview.lock` / `unlock`); the extension tracks the focused panel and sets the context key `latexPreview.locked` to switch the icon.

### Macros (`\newcommand` etc.)
- Macros used in the text are expanded by `parser.ts` at the token level, and the result is inserted in place (stops after 10000 expansions)
- Math is sent to the webview as raw TeX, so the definitions are sent along as `macros` and expanded by KaTeX's `macros` option. `latexPreview.mathMacros` is merged in before them, so definitions in the document win

### Adding a command or environment
Features are grouped into *packages* (`src/parser/render/packages/*.ts`) like LaTeX packages. A package declares the syntax (number of arguments) and the rendering together, so both the parser and the renderer read it.

1. Add a handler to `commands` or `environments` of a package (or create a new package)
   - `{ args: 2, render }` fixes the number of required arguments. Without `args`, all following `{...}` are taken as arguments
   - `mathEnvironments` lists environments whose body goes to KaTeX as raw TeX; `verbatimEnvironments` lists environments whose body is not interpreted
   - `counters` declares counters used for numbering
2. A new package is registered in `packages()` in `registry.ts`. Defining the same name in two packages throws
3. Add a case to `test/fixtures/*.tex` and run `npm test -- --update`, then check the diff of the expected files

### Strings that depend on the display language
- Strings in the package.json (command names, settings) go to `package.nls.json` / `package.nls.ja.json`
- Strings in the extension code use `vscode.l10n.t()`, with translations in `l10n/bundle.l10n.ja.json`
- Toolbar tooltips in the webview follow `<html lang>`, which the extension sets to `vscode.env.language`
- Notes that the renderer itself produces (file not found) are passed in through `RenderOptions.notFound`

## Releasing
`npm run release` (see `scripts/publish.mjs`) publishes the same `.vsix` to the VS Code Marketplace and Open VSX and attaches it to a GitHub Release. `npm run release -- patch` bumps the version first.
