import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// KaTeX の CSS / フォントと Webview 用 CSS を dist にコピー
mkdirSync('dist/web/katex', { recursive: true });
cpSync('node_modules/katex/dist/katex.min.css', 'dist/web/katex/katex.min.css');
cpSync('node_modules/katex/dist/fonts', 'dist/web/katex/fonts', {
  recursive: true,
  filter: (src) => !/\.(ttf|woff)$/.test(src),
});
cpSync('src/webview/preview.css', 'dist/web/preview.css');

const common = {
  bundle: true,
  target: 'es2022',
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ['src/extension.ts'],
    format: 'cjs',
    platform: 'browser',
    outfile: 'dist/web/extension.js',
    external: ['vscode'],
  }),
  esbuild.context({
    ...common,
    entryPoints: ['src/webview/preview.ts'],
    format: 'iife',
    platform: 'browser',
    outfile: 'dist/web/preview.js',
  }),
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
