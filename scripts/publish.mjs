// VS Code Marketplace と Open VSX に同じ .vsix を公開する
//   npm run release            今の version のまま公開
//   npm run release -- patch   version を上げて（コミットとタグも作って）から公開。minor / major も同じ
// 認証：Marketplace は `npx @vscode/vsce login kmmz1127` で保存したトークン、Open VSX は環境変数 OVSX_PAT
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

// 片方だけ公開されて止まらないよう、先に Open VSX のトークンを確かめる
if (!process.env.OVSX_PAT) {
  console.error('環境変数 OVSX_PAT が設定されていません（Open VSX のトークン）');
  process.exit(1);
}

const bump = process.argv[2];
if (bump) {
  run(`npm version ${bump}`);
}
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));

// .vsix はリポジトリに残さないよう OS の一時フォルダに作り、公開後に消す
const dir = mkdtempSync(join(tmpdir(), 'latex-preview-publish-'));
const vsix = join(dir, `${name}-${version}.vsix`);
try {
  run(`npx @vscode/vsce package --out "${vsix}"`);
  run(`npx @vscode/vsce publish --packagePath "${vsix}"`);
  run(`npx ovsx publish "${vsix}"`);
  console.log(`${version} を Marketplace と Open VSX に公開しました`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
