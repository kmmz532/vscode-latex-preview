import { Node, parse, Syntax } from '../parser';
import { base } from './packages/base';
import { bibliography } from './packages/bibliography';
import { graphicx } from './packages/graphicx';
import { math } from './packages/math';
import { tabular } from './packages/tabular';
import { verbatim } from './packages/verbatim';
import type { CommandDef, EnvDef, Package } from './types';

/** 有効なパッケージ。新しい機能はパッケージを作ってここに足す */
const packages = (): Package[] => [base, math, verbatim, tabular, graphicx, bibliography];

interface Registry {
  commands: Map<string, CommandDef>;
  environments: Map<string, EnvDef>;
  syntax: Syntax;
}

let cache: Registry | undefined;

/**
 * パッケージを 1 つの表にまとめる。
 * パッケージのモジュールは互いに循環して import しているので、パッケージの一覧も含めて初回利用時に作る
 */
export function registry(): Registry {
  if (cache) {
    return cache;
  }
  const commands = new Map<string, CommandDef>();
  const environments = new Map<string, EnvDef>();
  const mathEnvs = new Set<string>();
  const verbatimEnvs = new Set<string>();
  const add = <T>(map: Map<string, T>, name: string, def: T) => {
    if (map.has(name)) {
      throw new Error(`\\${name} is defined by more than one package`);
    }
    map.set(name, def);
  };
  for (const pkg of packages()) {
    for (const [name, def] of Object.entries(pkg.commands ?? {})) {
      add(commands, name, typeof def === 'function' ? { render: def } : def);
    }
    for (const [name, def] of Object.entries(pkg.environments ?? {})) {
      add(environments, name, typeof def === 'function' ? { render: def } : def);
    }
    pkg.mathEnvironments?.forEach((e) => mathEnvs.add(e));
    pkg.verbatimEnvironments?.forEach((e) => verbatimEnvs.add(e));
  }
  const syntax: Syntax = {
    math: mathEnvs,
    verbatim: verbatimEnvs,
    commandArgs: (name) => commands.get(name)?.args,
    envArgs: (name) => environments.get(name)?.args ?? 0,
  };
  cache = { commands, environments, syntax };
  return cache;
}

/** 引数やオプションに入っていた TeX ソースを、文書と同じ規則で構文解析する */
export function parseFragment(src: string): Node[] {
  return parse(src, registry().syntax);
}
