/** \input / \include で読み込むファイルの表のキー（拡張子 .tex は省いてもよいので外す） */
export function inputKey(name: string): string {
  return name.trim().replace(/\.tex$/i, '');
}
