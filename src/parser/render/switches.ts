import { plain } from './text';
import type { CommandNode } from './types';

/** {\bf ...} や \large のように、以降（グループの終わりまで）に効く宣言型コマンド */
const CLASSES: Record<string, string> = {
  bf: 'f-bf',
  bfseries: 'f-bf',
  it: 'f-it',
  itshape: 'f-it',
  sl: 'f-it',
  slshape: 'f-it',
  em: 'f-it',
  tt: 'f-tt',
  ttfamily: 'f-tt',
  sf: 'f-sf',
  sffamily: 'f-sf',
  sc: 'f-sc',
  scshape: 'f-sc',
  rm: 'f-rm',
  rmfamily: 'f-rm',
  mdseries: 'f-rm',
  upshape: 'f-rm',
  normalfont: 'f-rm',
  tiny: 'sz-tiny',
  scriptsize: 'sz-scriptsize',
  footnotesize: 'sz-footnotesize',
  small: 'sz-small',
  normalsize: 'sz-normalsize',
  large: 'sz-large',
  Large: 'sz-Large',
  LARGE: 'sz-LARGE',
  huge: 'sz-huge',
  Huge: 'sz-Huge',
};

/** 引数を取らない宣言型コマンドの名前（レジストリへの登録用） */
export const SWITCH_NAMES = Object.keys(CLASSES);

/** 段落の配置を変える宣言型コマンド */
export const ALIGN_SWITCHES: Record<string, string> = {
  centering: 'center',
  raggedright: 'left',
  raggedleft: 'right',
};

/** 段落の配置を変えるコマンドなら配置を返す */
export function alignOf(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(ALIGN_SWITCHES, name) ? ALIGN_SWITCHES[name] : undefined;
}

/** 色の指定（\textcolor / \color）を CSS の色にする。使えない値は undefined */
export function cssColor(model: string | undefined, spec: string): string | undefined {
  const s = spec.trim();
  if (model === 'HTML' && /^[0-9a-fA-F]{6}$/.test(s)) {
    return `#${s}`;
  }
  if (model === undefined && /^[a-zA-Z]+$/.test(s)) {
    return s.toLowerCase();
  }
  return undefined;
}

/** 宣言型コマンドなら、以降を囲む開始タグを返す（そうでなければ undefined） */
export function switchOpen(n: CommandNode): string | undefined {
  const cls = Object.prototype.hasOwnProperty.call(CLASSES, n.name) ? CLASSES[n.name] : undefined;
  if (cls) {
    return `<span class="${cls}">`;
  }
  if (n.name === 'color') {
    const c = cssColor(n.opt, plain(n.args[0]));
    return c ? `<span style="color:${c}">` : '<span>';
  }
  return undefined;
}
