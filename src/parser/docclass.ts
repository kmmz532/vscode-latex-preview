import { Node } from './parser';

/** 文書クラスとプリアンブルから決まる組版パラメータ（値は CSS の長さ） */
export interface Layout {
  japanese: boolean;
  twoColumn: boolean;
  fontSize: string;
  lineHeight: number;
  parindent: string;
  textwidth: string;
  textheight: string;
  columnsep: string;
}

/** jsarticle の和文 1 字（1zw）。和文は欧文の 0.924961 倍で組まれる */
const ZW = '0.925em';

/** 用紙の幅と高さ（mm）。b5 は jsarticle では JIS B5、article では ISO B5 */
const PAPER_MM: Record<string, (ja: boolean) => [number, number]> = {
  a4paper: () => [210, 297],
  a5paper: () => [148, 210],
  b5paper: (ja) => (ja ? [182, 257] : [176, 250]),
  letterpaper: () => [215.9, 279.4],
};

/** article 系の \textheight の行数（size1x.clo の値） */
const ARTICLE_LINES: Record<number, number> = { 10: 43, 11: 38, 12: 36 };

/**
 * 主要な文書クラスの既定値を近似する。
 * - jsarticle 系: \baselineskip は文字サイズの 1.6 倍、\parindent 1zw、\columnsep 2zw、
 *   \textwidth は 1 段組で用紙幅の 0.76 倍・2 段組で 0.85 倍、\textheight は用紙高さの 0.83 倍
 * - article 系: size1x.clo の値（\baselineskip 1.2 倍、\parindent 15/17pt/1.5em、\columnsep 10pt）、
 *   \textwidth は 1 段組で 345/360/390pt、2 段組で 用紙幅 - 2in
 */
export function computeLayout(nodes: Node[], plain: (n: Node[] | undefined) => string): Layout {
  const cls = nodes.find((n) => n.kind === 'command' && n.name === 'documentclass');
  const name = cls?.kind === 'command' ? plain(cls.args[0]).trim() : '';
  const opts = cls?.kind === 'command' ? (cls.opt ?? '').split(',').map((o) => o.trim()) : [];

  // jarticle, jsarticle, ltjsarticle, bxjsarticle など
  const japanese = /^(lt|bx)?j/.test(name);
  const twoColumn = opts.includes('twocolumn');
  const size = opts.includes('12pt') ? 12 : opts.includes('11pt') ? 11 : 10;
  const paper = opts.find((o) => o in PAPER_MM);
  const [paperMm, paperHeightMm] = PAPER_MM[paper ?? 'a4paper'](japanese);

  const layout: Layout = japanese
    ? {
        japanese,
        twoColumn,
        fontSize: `${size}pt`,
        lineHeight: 1.6,
        parindent: ZW,
        textwidth: `${(paperMm * (twoColumn ? 0.85 : 0.76)).toFixed(1)}mm`,
        textheight: `${(paperHeightMm * 0.83).toFixed(1)}mm`,
        columnsep: `calc(2 * ${ZW})`,
      }
    : {
        japanese,
        twoColumn,
        fontSize: `${size}pt`,
        lineHeight: 1.2,
        parindent: size === 10 ? '15pt' : size === 11 ? '17pt' : '1.5em',
        textwidth: twoColumn ? `${(paperMm - 50.8).toFixed(1)}mm` : `${size === 10 ? 345 : size === 11 ? 360 : 390}pt`,
        // \topskip + (行数 - 1) * \baselineskip
        textheight: `${(size + (ARTICLE_LINES[size] - 1) * size * 1.2).toFixed(1)}pt`,
        columnsep: '10pt',
      };

  // プリアンブルで明示された寸法を優先
  for (const n of nodes) {
    if (n.kind !== 'command' || n.name !== 'setlength' || n.args.length < 2) {
      continue;
    }
    const target = n.args[0].find((a) => a.kind === 'command');
    const value = toCssLength(plain(n.args[1]), japanese);
    if (target?.kind !== 'command' || !value) {
      continue;
    }
    if (target.name === 'textwidth') {
      layout.textwidth = value;
    } else if (target.name === 'textheight') {
      layout.textheight = value;
    } else if (target.name === 'columnsep') {
      layout.columnsep = value;
    } else if (target.name === 'parindent') {
      layout.parindent = value;
    }
  }
  return layout;
}

/** TeX の寸法を CSS の長さに変換する。式など解釈できないものは undefined */
function toCssLength(s: string, japanese: boolean): string | undefined {
  const m = /^\s*(-?\d*\.?\d+)\s*(true)?(mm|cm|in|pt|bp|em|ex|zw|zh|pc)\s*$/.exec(s);
  if (!m) {
    return undefined;
  }
  const num = parseFloat(m[1]);
  switch (m[3]) {
    case 'zw':
    case 'zh':
      return japanese ? `calc(${num} * ${ZW})` : `${num}em`;
    case 'bp':
      // CSS の pt は 1/72in で TeX の bp と同じ
      return `${num}pt`;
    case 'pt':
      // TeX の pt は 1/72.27in
      return `${(num * 72 / 72.27).toFixed(2)}pt`;
    default:
      return `${num}${m[3]}`;
  }
}
