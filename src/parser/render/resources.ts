import type { Node } from '../parser';
import { plain, walk } from './text';

/** 文書が参照する外部ファイル（拡張機能側が読み込んで RenderOptions で渡す） */
export interface DocumentResources {
  /** \bibliography{a,b} の .bib（拡張子なし、出現順・重複なし） */
  bibliographies: string[];
  /** \includegraphics のパス（ソースに書かれたまま、重複なし） */
  graphics: string[];
  /** \graphicspath{{dir1/}{dir2/}} のフォルダ（最後の指定） */
  graphicsPaths: string[];
  /** \input / \include のうち、まだ中身を渡されていないファイル（拡張子 .tex なし） */
  inputs: string[];
}

/** 構文木から参照を集める。コメントは字句解析で除かれ、マクロは展開済み */
export function collectResources(nodes: Node[], inputs: string[] = []): DocumentResources {
  const bibliographies = new Set<string>();
  const graphics = new Set<string>();
  let graphicsPaths: string[] = [];
  walk(nodes, (n) => {
    if (n.kind !== 'command') {
      return;
    }
    switch (n.name) {
      case 'bibliography':
        for (const name of plain(n.args[0]).split(',')) {
          const s = name.trim().replace(/\.bib$/, '');
          if (s) {
            bibliographies.add(s);
          }
        }
        break;
      case 'includegraphics':
      case 'includegraphics*': {
        const p = plain(n.args[0]).trim();
        if (p) {
          graphics.add(p);
        }
        break;
      }
      case 'graphicspath':
        graphicsPaths = (n.args[0] ?? [])
          .filter((g) => g.kind === 'group')
          .map((g) => plain(g.kind === 'group' ? g.children : []).trim());
        break;
    }
  });
  return { bibliographies: [...bibliographies], graphics: [...graphics], graphicsPaths, inputs };
}
