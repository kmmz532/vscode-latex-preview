import type { Node } from '../parser';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderText(s: string): string {
  return escapeHtml(
    s
      .replace(/---/g, '—')
      .replace(/--/g, '–')
      .replace(/``/g, '“')
      .replace(/''/g, '”')
      .replace(/`/g, '‘')
      .replace(/~/g, ' ')
  );
}

export function plain(nodes: Node[] | undefined): string {
  if (!nodes) {
    return '';
  }
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.value;
        case 'group':
          return plain(n.children);
        case 'command':
          return n.name.length === 1 ? n.name : '';
        default:
          return '';
      }
    })
    .join('');
}

/** ノードを TeX ソースに近い文字列に戻す（列指定の解釈用） */
export function nodesToSource(nodes: Node[] | undefined): string {
  if (!nodes) {
    return '';
  }
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.value;
        case 'group':
          return `{${nodesToSource(n.children)}}`;
        case 'command':
          return '\\' + n.name + n.args.map((a) => `{${nodesToSource(a)}}`).join('');
        default:
          return '';
      }
    })
    .join('');
}

export function walk(nodes: Node[], visit: (n: Node) => void) {
  for (const n of nodes) {
    visit(n);
    if (n.kind === 'group') {
      walk(n.children, visit);
    } else if (n.kind === 'command') {
      n.args.forEach((a) => walk(a, visit));
    } else if (n.kind === 'env') {
      n.args.forEach((a) => walk(a, visit));
      walk(n.children, visit);
    }
  }
}

/** "caption={a, b}, label=x" のような key=value 列（{} の中のカンマでは区切らない） */
export function parseKeyValues(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let buf = '';
  const flush = () => {
    const m = /^\s*([^=]+?)\s*(?:=\s*(.*?))?\s*$/s.exec(buf);
    if (m && m[1]) {
      out[m[1]] = (m[2] ?? '').replace(/^\{([\s\S]*)\}$/, '$1');
    }
    buf = '';
  };
  for (const c of s) {
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    } else if (c === ',' && depth === 0) {
      flush();
      continue;
    }
    buf += c;
  }
  flush();
  return out;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
