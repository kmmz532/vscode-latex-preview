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
