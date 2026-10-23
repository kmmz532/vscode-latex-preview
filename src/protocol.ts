/** 拡張機能と Webview の間でやり取りするメッセージ（両側から型として参照する） */

/** 拡張機能 → Webview */
export type ToWebview =
  /** 描画結果。line はエディタの表示位置（同期中はそこへスクロールする） */
  | { type: 'update'; html: string; macros: Record<string, string>; line?: number }
  /** Webview 側で使う設定（latexPreview.*） */
  | { type: 'config'; scrollSync: boolean }
  /** エディタのスクロールに合わせる */
  | { type: 'scrollTo'; line: number };

/** Webview → 拡張機能 */
export type FromWebview =
  /** スクリプトの読み込み完了（初回描画の合図） */
  | { type: 'ready' }
  /** プレビューのスクロールにエディタを合わせる */
  | { type: 'reveal'; line: number }
  /** ダブルクリックした段落の行をエディタで開く */
  | { type: 'open'; line: number };
