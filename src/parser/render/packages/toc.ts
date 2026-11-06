import type { Ctx } from '../types';

/** \tableofcontents の位置に置く目印（見出しを描き終えてから目次に置き換える） */
export const TOC_MARK = 'toc';

/** 見出しの一覧（ページ番号は再現できないので載せない） */
export function renderToc(ctx: Ctx): string {
  const items = ctx.toc
    .map((e) => `<div class="toc-item l${e.level}"><span class="toc-num">${e.num}</span>${e.html}</div>`)
    .join('');
  return `<nav class="toc"><div class="toc-title">${ctx.locale.contentsName}</div>${items}</nav>`;
}
