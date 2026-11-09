/**
 * explainLine: a node and the nodes it was computed from, down to `depth`.
 * `ref` is a node id ("agi") or "<form>:<line>" ("f1040:16", "schSE.taxpayer:12").
 */
import { getParams } from './params/index.ts';
import type { Explanation, LineNode, ReturnResult } from './types.ts';

function resolve(result: ReturnResult, ref: string): LineNode | undefined {
  if (!ref) return undefined;
  const direct = result.nodes[ref];
  if (direct) return direct;
  // Form ids never contain ':', lines may ("schE:3:A", "f8829.taxpayer:16:b").
  const sep = ref.indexOf(':');
  if (sep <= 0) return undefined;
  const form = ref.slice(0, sep);
  const line = ref.slice(sep + 1);
  for (const node of Object.values(result.nodes)) {
    if (node.form === form && node.line === line) return node;
  }
  // A line that repeats another one (Schedule C line 5 = line 7 here):
  // explain the source node, but as the line that was asked about.
  const params = getParams(result.taxYear);
  const alias = params.lineAliases[ref];
  const source = alias ? result.nodes[alias] : undefined;
  if (!source) return undefined;
  return {
    ...source,
    form: form as LineNode['form'],
    line,
    label:
      params.lineAliasLabels[`${form.split('.')[0]}:${line}`] ?? source.label,
  };
}

function build(
  result: ReturnResult,
  node: LineNode,
  depth: number,
  seen: Set<string>
): Explanation {
  if (depth <= 0 || seen.has(node.id)) return { node, children: [] };
  const next = new Set(seen).add(node.id);
  const children: Explanation[] = [];
  for (const input of node.trace.inputs) {
    if (input.kind !== 'node') continue;
    const child = result.nodes[input.ref];
    if (child) children.push(build(result, child, depth - 1, next));
  }
  return { node, children };
}

export function explainLine(
  result: ReturnResult,
  ref: string,
  depth = 2
): Explanation | null {
  const node = resolve(result, ref.trim());
  return node
    ? build(result, node, Math.max(0, Math.floor(depth)), new Set())
    : null;
}
