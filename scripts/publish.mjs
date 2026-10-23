// VS Code Marketplace と Open VSX に同じ .vsix を公開し、GitHub Release にも添付する
//   npm run release            今の version のまま公開
//   npm run release -- patch   version を上げて（コミットとタグも作って）から公開。minor / major も同じ
// 認証：Marketplace は `npx @vscode/vsce login kmmz1127` で保存したトークン、Open VSX は環境変数 OVSX_PAT、
//       GitHub は gh CLI のログイン（リポジトリに push できるアカウント）
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const read = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// 一部だけ公開されて止まらないよう、認証を先に確かめる
if (!process.env.OVSX_PAT) {
  fail('環境変数 OVSX_PAT が設定されていません（Open VSX のトークン）');
}
let canPush = false;
try {
  canPush = read('gh repo view --json viewerPermission --jq .viewerPermission').match(/^(WRITE|MAINTAIN|ADMIN)$/) !== null;
} catch {
  // gh が未ログインなど
}
if (!canPush) {
  fail('gh CLI のアカウントにこのリポジトリへの push 権限がありません（gh auth switch で切り替える）');
}

const bump = process.argv[2];
if (bump) {
  run(`npm version ${bump}`);
}
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${version}`;

// .vsix はリポジトリに残さないよう OS の一時フォルダに作り、公開後に消す
const dir = mkdtempSync(join(tmpdir(), 'latex-preview-publish-'));
const vsix = join(dir, `${name}-${version}.vsix`);
try {
  run(`npx @vscode/vsce package --out "${vsix}"`);
  run(`npx @vscode/vsce publish --packagePath "${vsix}"`);
  run(`npx ovsx publish "${vsix}"`);
  // npm version で作ったコミットとタグを送ってからリリースを作る（タグがなければ今のコミットに作られる）
  run('git push --follow-tags');
  run(`gh release create ${tag} "${vsix}" --title ${tag} --generate-notes --target ${read('git rev-parse HEAD')}`);
  console.log(`${version} を Marketplace・Open VSX・GitHub Release に公開しました`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
