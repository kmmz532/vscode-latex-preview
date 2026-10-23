import { runTests } from '@vscode/test-web';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ワークスペース内に展開すると VS Code のファイル監視等とぶつかって展開に失敗するため、OS の一時フォルダを使う
await runTests({
  browserType: 'chromium',
  quality: 'stable',
  extensionDevelopmentPath: resolve('.'),
  folderPath: resolve('sample'),
  testRunnerDataDir: join(tmpdir(), 'vscode-test-web'),
  headless: false,
});
