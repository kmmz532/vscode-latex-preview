import type { Node } from '../parser';
import { renderInline } from './blocks';
import { nodesToSource, plain } from './text';
import { block, Ctx, EnvNode, Out } from './types';

interface Column {
  align: 'left' | 'center' | 'right';
  width?: string;
  /** 列の左側の縦線の本数 */
  borderLeft: number;
  borderRight: number;
}

interface Row {
  cells: Node[][];
  /** この行の上に引く横線の本数 */
  hlines: number;
  /** この行の上に引く部分的な横線（\cline{a-b}、列番号は 1 始まり） */
  clines: [number, number][];
}

/** 列指定（|l|c|r|, p{3cm}, *{3}{c}, @{} など）を解釈する */
function parseColSpec(spec: string): Column[] {
  // *{n}{...} を展開
  for (let k = 0; k < 10 && spec.includes('*{'); k++) {
    spec = spec.replace(/\*\{(\d+)\}\{([^{}]*)\}/g, (_, n, s) => s.repeat(parseInt(n, 10)));
  }
  const cols: Column[] = [];
  let pending = 0;
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    const readBraced = () => {
      if (spec[i + 1] !== '{') {
        return '';
      }
      let depth = 0;
      const start = i + 2;
      for (let j = i + 1; j < spec.length; j++) {
        if (spec[j] === '{') {
          depth++;
        } else if (spec[j] === '}' && --depth === 0) {
          i = j;
          return spec.slice(start, j);
        }
      }
      i = spec.length;
      return spec.slice(start);
    };
    if (c === '|') {
      // 列の後ろの | はその列の右線、先頭の | は最初の列の左線
      if (cols.length) {
        cols[cols.length - 1].borderRight++;
      } else {
        pending++;
      }
    } else if (c === 'l' || c === 'c' || c === 'r') {
      cols.push({ align: c === 'l' ? 'left' : c === 'c' ? 'center' : 'right', borderLeft: pending, borderRight: 0 });
      pending = 0;
    } else if (c === 'p' || c === 'm' || c === 'b' || c === 'X') {
      const w = c === 'X' ? undefined : readBraced();
      cols.push({ align: 'left', width: w ? toWidth(w) : undefined, borderLeft: pending, borderRight: 0 });
      pending = 0;
    } else if (c === '@' || c === '!' || c === '>' || c === '<') {
      readBraced();
    }
  }
  return cols;
}

function toWidth(w: string): string | undefined {
  const m = /^\s*(\d*\.?\d+)\s*(mm|cm|in|pt|em|ex)\s*$/.exec(w);
  if (m) {
    return `${m[1]}${m[2]}`;
  }
  const rel = /^\s*(\d*\.?\d+)?\s*\\(linewidth|textwidth|columnwidth|hsize)\s*$/.exec(w);
  return rel ? `${parseFloat(rel[1] ?? '1') * 100}%` : undefined;
}

/** 子ノードを \\ で行に、& でセルに分ける */
function splitRows(children: Node[]): Row[] {
  const rows: Row[] = [];
  let row: Row = { cells: [[]], hlines: 0, clines: [] };
  const cell = () => row.cells[row.cells.length - 1];
  for (const n of children) {
    if (n.kind === 'command' && (n.name === '\\' || n.name === 'tabularnewline')) {
      rows.push(row);
      row = { cells: [[]], hlines: 0, clines: [] };
    } else if (n.kind === 'command' && (n.name === 'hline' || n.name === 'toprule' || n.name === 'midrule' || n.name === 'bottomrule')) {
      row.hlines++;
    } else if (n.kind === 'command' && (n.name === 'cline' || n.name === 'cmidrule')) {
      // \cline{2-3} / \cmidrule(lr){2-3}
      const m = /(\d+)\s*-\s*(\d+)/.exec(plain(n.args[n.args.length - 1]));
      if (m) {
        row.clines.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
      }
    } else if (n.kind === 'text' && n.value.includes('&')) {
      const parts = n.value.split('&');
      parts.forEach((p, k) => {
        if (k > 0) {
          row.cells.push([]);
        }
        if (p) {
          cell().push({ ...n, value: p });
        }
      });
    } else {
      cell().push(n);
    }
  }
  rows.push(row);
  return rows;
}

const isBlank = (nodes: Node[]) => nodes.every((n) => n.kind === 'text' && !n.value.trim());

export function tabular(n: EnvNode, ctx: Ctx): Out {
  // tabular*{幅}{列指定} / tabularx{幅}{列指定}
  const spec = n.args[n.name === 'tabular' ? 0 : 1];
  const cols = parseColSpec(nodesToSource(spec));
  const rows = splitRows(n.children);
  // 最後の \\ の後ろは横線だけの行になるので、表の下線として扱う
  const last = rows[rows.length - 1];
  let bottom: Pick<Row, 'hlines' | 'clines'> = { hlines: 0, clines: [] };
  if (last && last.cells.length === 1 && isBlank(last.cells[0])) {
    bottom = last;
    rows.pop();
  }
  const border = (count: number) => (count >= 2 ? '3px double' : count === 1 ? '1px solid' : '');
  /** 横線の本数（全幅の \hline か、列 from〜to を含む \cline） */
  const lineAt = (r: Pick<Row, 'hlines' | 'clines'>, from: number, to: number) =>
    r.hlines || (r.clines.some(([a, b]) => a <= from && to <= b) ? 1 : 0);
  /** \multirow で下の行に食い込んでいる列（列 → 残り行数） */
  const covered = new Map<number, number>();
  const trs = rows.map((r, ri) => {
    const next = ri + 1 < rows.length ? rows[ri + 1] : bottom;
    let col = 0;
    const tds = r.cells.map((c) => {
      // 上の行の \multirow が覆っている列は、空セルを読み飛ばす
      const cover = covered.get(col) ?? 0;
      if (cover > 0) {
        covered.set(col, cover - 1);
        col++;
        return '';
      }
      let span = 1;
      let rowspan = 1;
      let col0 = cols[col];
      let content = c;
      let lastCol: Column | undefined;
      // \multicolumn{n}{spec}{content}：揃えと縦線は spec に従う
      const mc = c.filter((x) => !(x.kind === 'text' && !x.value.trim()));
      if (mc.length === 1 && mc[0].kind === 'command' && mc[0].name === 'multicolumn') {
        span = parseInt(plain(mc[0].args[0]), 10) || 1;
        col0 = lastCol = parseColSpec(nodesToSource(mc[0].args[1]))[0] ?? col0;
        content = mc[0].args[2] ?? [];
      } else {
        lastCol = cols[col + span - 1];
      }
      // \multirow{n}{幅}{content}（\multicolumn の中でも可）
      const mr = content.filter((x) => !(x.kind === 'text' && !x.value.trim()));
      if (mr.length === 1 && mr[0].kind === 'command' && mr[0].name === 'multirow') {
        rowspan = Math.max(1, Math.min(parseInt(plain(mr[0].args[0]), 10) || 1, rows.length - ri));
        content = mr[0].args[2] ?? [];
        for (let k = col; k < col + span; k++) {
          covered.set(k, rowspan - 1);
        }
      }
      const from = col + 1;
      const to = col + span;
      col += span;
      const top = lineAt(r, from, to);
      const below = lineAt(rowspan > 1 ? (ri + rowspan < rows.length ? rows[ri + rowspan] : bottom) : next, from, to);
      const style: string[] = [`text-align:${col0?.align ?? 'left'}`];
      if (col0?.width) {
        style.push(`width:${col0.width}`);
      }
      if (col0?.borderLeft) {
        style.push(`border-left:${border(col0.borderLeft)}`);
      }
      if (lastCol?.borderRight) {
        style.push(`border-right:${border(lastCol.borderRight)}`);
      }
      if (top) {
        style.push(`border-top:${border(top)}`);
      }
      if (below) {
        style.push(`border-bottom:${border(below)}`);
      }
      if (rowspan > 1) {
        style.push('vertical-align:middle');
      }
      const attrs = (span > 1 ? ` colspan="${span}"` : '') + (rowspan > 1 ? ` rowspan="${rowspan}"` : '');
      return `<td${attrs} style="${style.join(';')}">${renderInline(content, ctx).trim()}</td>`;
    });
    return `<tr>${tds.join('')}</tr>`;
  });
  return block(`<table class="tabular" data-line="${n.line}">${trs.join('')}</table>`);
}
