import { escapeHtml, parseKeyValues, plain } from '../text';
import { CommandNode, Ctx, inline, Out, Package } from '../types';

/** includegraphics。画像の中身は拡張機能側で読み、RenderOptions.images で渡される */
export const graphicx: Package = {
  commands: { includegraphics },
};

/** width=0.5\linewidth / 5cm などを CSS の長さにする */
function graphicsLength(s: string): string | undefined {
  const rel = /^\s*(\d*\.?\d+)?\s*\\(linewidth|textwidth|columnwidth|hsize|textheight)\s*$/.exec(s);
  if (rel) {
    const ratio = parseFloat(rel[1] ?? '1');
    return rel[2] === 'textheight' ? `calc(${ratio} * var(--textheight))` : `${ratio * 100}%`;
  }
  const m = /^\s*(\d*\.?\d+)\s*(mm|cm|in|pt|bp|em|ex|px)?\s*$/.exec(s);
  if (!m) {
    return undefined;
  }
  // 単位なしは bp（graphicx の既定）
  const unit = m[2] === 'bp' || !m[2] ? 'pt' : m[2];
  return `${m[1]}${unit}`;
}

function includegraphics(n: CommandNode, ctx: Ctx): Out {
  const file = plain(n.args[0]).trim();
  const src = ctx.opts.images?.[file];
  const opts = parseKeyValues(n.opt ?? '');
  const style: string[] = [];
  const width = opts.width !== undefined ? graphicsLength(opts.width) : undefined;
  const height = opts.height !== undefined ? graphicsLength(opts.height) : undefined;
  if (width) {
    style.push(`width:${width}`);
  }
  if (height) {
    style.push(`height:${height}`);
  }
  if (width && height && !('keepaspectratio' in opts)) {
    style.push('object-fit:fill');
  } else if (width && height) {
    style.push('object-fit:contain');
  }
  const scale = parseFloat(opts.scale ?? '');
  if (!width && !height && scale > 0) {
    style.push(`zoom:${scale}`);
  }
  if (opts.angle) {
    style.push(`rotate:${-parseFloat(opts.angle) || 0}deg`);
  }
  const css = style.length ? ` style="${style.join(';')}"` : '';
  if (src) {
    return inline(`<img class="graphics-img" src="${escapeHtml(src)}" alt="${escapeHtml(file)}"${css}>`);
  }
  // 見つからない・EPS / PDF などブラウザで表示できないものはファイル名の枠
  return inline(`<span class="graphics"${width ? ` style="width:${width}"` : ''}>${file ? escapeHtml(file) : 'image'}</span>`);
}
