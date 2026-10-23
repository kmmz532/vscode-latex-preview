// レンダラのゴールデンテスト：test/fixtures/*.tex の描画結果を *.html と比較する
// 期待値の更新は `npm test -- --update`
import * as esbuild from 'esbuild';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const update = process.argv.includes('--update');

// \today の結果が実行日で変わらないよう、現在日時を固定する
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [2024, 0, 2]));
  }
};
const dir = 'test/fixtures';
const out = join(mkdtempSync(join(tmpdir(), 'latex-preview-')), 'render.mjs');
await esbuild.build({ entryPoints: ['src/parser/render/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
const { renderDocument } = await import(pathToFileURL(out).href);

const bibFiles = {};
// \input / \include するファイル（test/fixtures/inputs/*.tex。キーは .tex を除いたパス）
const inputs = {};
for (const f of readdirSync(join(dir, 'inputs')).filter((f) => f.endsWith('.tex'))) {
  inputs['inputs/' + f.replace(/\.tex$/, '')] = readFileSync(join(dir, 'inputs', f), 'utf8');
}
for (const f of readdirSync(dir).filter((f) => f.endsWith('.bib'))) {
  bibFiles[f.replace(/\.bib$/, '')] = readFileSync(join(dir, f), 'utf8');
}
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.tex'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  for (const showUnknownCommands of [true, false]) {
    const { html, macros } = renderDocument(src, { showUnknownCommands, bibFiles, inputs, images: { img: 'data:image/png;base64,AA==' } });
    // 比較しやすいようタグごとに改行
    const actual = html.replace(/></g, '>\n<') + '\n\n' + JSON.stringify(macros, null, 2) + '\n';
    const file = join(dir, f.replace(/\.tex$/, showUnknownCommands ? '.html' : '.hidden.html'));
    if (update || !existsSync(file)) {
      writeFileSync(file, actual);
    } else if (readFileSync(file, 'utf8') !== actual) {
      failed++;
      console.error(`FAIL ${file}`);
      writeFileSync(file + '.actual', actual);
    }
  }
}
console.log(failed ? `${failed} failed (see *.actual)` : 'all passed');
process.exit(failed ? 1 : 0);
