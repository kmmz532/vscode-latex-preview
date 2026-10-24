import { renderInline } from '../blocks';
import { escapeHtml, plain } from '../text';
import { CommandHandler, ignore, inline, NOTHING, Package } from '../types';

const wrap = (cls: string): CommandHandler => (n, ctx) => inline(`<span class="${cls}">${renderInline(n.args[0], ctx)}</span>`);

/**
 * ルビ（pxrubrica / okumacro の \ruby{親文字}{ルビ}）。
 * pxrubrica と同じく | で区切ると、区切りごとに対応させたモノルビになる
 */
const ruby: CommandHandler = (n, ctx) => {
  const reading = plain(n.args[1] ?? []);
  const base = plain(n.args[0]);
  const bases = base.split('|');
  const readings = reading.split('|');
  if (bases.length > 1 && bases.length === readings.length) {
    return inline(`<ruby>${bases.map((b, i) => `${escapeHtml(b)}<rt>${escapeHtml(readings[i])}</rt>`).join('')}</ruby>`);
  }
  const html = base.includes('|') ? escapeHtml(base.replace(/\|/g, '')) : renderInline(n.args[0], ctx);
  return inline(`<ruby>${html}<rt>${escapeHtml(reading.replace(/\|/g, ''))}</rt></ruby>`);
};

/** 日本語文書（pLaTeX / LuaLaTeX-ja、jsclasses、otf、pxrubrica など）でよく使うコマンド */
export const japanese: Package = {
  commands: {
    textgt: wrap('gt'),
    textmc: wrap('mc'),
    // 宣言型の書体切替は範囲を追えないので無視する（\bfseries などと同じ）
    gtfamily: { args: 0, render: ignore },
    mcfamily: { args: 0, render: ignore },

    ruby: { args: 2, render: ruby },
    kenten: wrap('kenten'),
    bou: wrap('kenten'),

    // otf パッケージ：\UTF{8449} は U+8449
    UTF: (n) => {
      const code = parseInt(plain(n.args[0]).trim(), 16);
      return inline(Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? escapeHtml(String.fromCodePoint(code)) : '');
    },

    // jsclasses の \today の表記切替
    西暦: {
      args: 0,
      render: (_, ctx) => {
        ctx.wareki = false;
        return NOTHING;
      },
    },
    和暦: {
      args: 0,
      render: (_, ctx) => {
        ctx.wareki = true;
        return NOTHING;
      },
    },

    // 和文の組版の調整は表示に影響しないので無視する
    inhibitglue: { args: 0, render: ignore },
    ltjsetparameter: { args: 1, render: ignore },
  },
};
