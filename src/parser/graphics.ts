/** ブラウザで表示できる画像の拡張子と MIME タイプ */
export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** \includegraphics で拡張子が省略されたときに試す順（graphicx の既定に近い順） */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'pdf', 'eps'];

/** 文書中の \includegraphics のパスと \graphicspath のフォルダ。コメント行は除く */
export function findGraphics(src: string): { paths: string[]; dirs: string[] } {
  const code = src.replace(/(^|[^\\])%.*$/gm, '$1');
  const paths = new Set<string>();
  for (const m of code.matchAll(/\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
    const p = m[1].trim();
    if (p) {
      paths.add(p);
    }
  }
  const dirs: string[] = [];
  const gp = /\\graphicspath\s*\{((?:\s*\{[^}]*\})*)\s*\}/.exec(code);
  if (gp) {
    for (const d of gp[1].matchAll(/\{([^}]*)\}/g)) {
      dirs.push(d[1].trim());
    }
  }
  return { paths: [...paths], dirs };
}
