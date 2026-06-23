import type { Tree } from "@lezer/common";
import { type AbstractElem, childElems, groupBy, type WeslAST } from "wesl";

export interface NodeInfo {
  type: string;
  start: number;
}

export interface CompareResult {
  matching: number;
  missingInLezer: NodeInfo[];
  missingInWesl: NodeInfo[];
}

// Map wesl AST kinds to lezer node types.
// Note: call-expression excluded - lezer's CallExpression is only for template calls,
// while regular calls are PostfixExpression with ArgList.
const weslToLezer: Record<string, string> = {
  fn: "FunctionDeclaration",
  struct: "StructDeclaration",
  gvar: "GlobalVariableDeclaration",
  const: "GlobalValueDeclaration",
  override: "GlobalValueDeclaration",
  alias: "TypeAliasDeclaration",
  type: "Type",
  import: "Import",
  member: "StructMember",
  param: "Param",
  assert: "ConstAssert",
};

// Local declarations use the same wesl kinds as globals but map to VarStatement in lezer.
const localDeclKinds = new Set(["var", "let", "const"]);

// Expression nodes whose operands are sub-expressions. childElems descends into
// these, but lezer structures expressions differently and they hold no
// comparable container nodes, so we stop at them (like `type` below).
const exprOperatorKinds = new Set([
  "binary-expression",
  "unary-expression",
  "call-expression",
  "parenthesized-expression",
  "component-expression",
  "component-member-expression",
]);

const lezerTypes = new Set(Object.values(weslToLezer));

/** Extract comparable nodes from a lezer parse tree. */
export function extractLezerNodes(tree: Tree): NodeInfo[] {
  const nodes: NodeInfo[] = [];
  tree.iterate({
    enter(node) {
      if (lezerTypes.has(node.type.name)) {
        nodes.push({ type: node.type.name, start: node.from });
      }
    },
  });
  return nodes;
}

/** Extract comparable nodes from a wesl AST. */
export function extractWeslNodes(ast: WeslAST): NodeInfo[] {
  const nodes: NodeInfo[] = [];
  collectNodes(ast.moduleElem, false, nodes);
  return nodes;
}

/** Compare nodes from wesl and lezer ASTs, matching by type and start position. */
export function compareNodes(
  wesl: NodeInfo[],
  lezer: NodeInfo[],
): CompareResult {
  let matching = 0;
  const missingInLezer: NodeInfo[] = [];
  const missingInWesl: NodeInfo[] = [];
  const weslByType = groupBy(wesl, n => n.type);
  const lezerByType = groupBy(lezer, n => n.type);
  const allTypes = new Set([...weslByType.keys(), ...lezerByType.keys()]);

  for (const type of allTypes) {
    const weslNodes = weslByType.get(type) ?? [];
    const lezerNodes = lezerByType.get(type) ?? [];
    const lezerStarts = new Set(lezerNodes.map(n => n.start));
    const weslStarts = new Set(weslNodes.map(n => n.start));

    for (const wn of weslNodes) {
      if (lezerStarts.has(wn.start)) matching++;
      else missingInLezer.push(wn);
    }
    for (const ln of lezerNodes) {
      if (!weslStarts.has(ln.start)) missingInWesl.push(ln);
    }
  }

  return { matching, missingInLezer, missingInWesl };
}

/** Walk container elements only (not expressions), collecting mapped nodes. */
function collectNodes(
  elem: AbstractElem,
  inFn: boolean,
  nodes: NodeInfo[],
): void {
  const isLocalDecl = inFn && localDeclKinds.has(elem.kind);
  const mapped = isLocalDecl ? null : (weslToLezer[elem.kind] ?? null);
  if (mapped && "start" in elem)
    nodes.push({ type: mapped, start: elem.start });

  // a type's contents are template-param expressions (incl. nested type refs);
  // don't descend - lezer does not emit comparable nested nodes there
  if (elem.kind === "type" || exprOperatorKinds.has(elem.kind)) return;
  const childInFn = inFn || elem.kind === "fn";
  for (const child of childElems(elem)) collectNodes(child, childInFn, nodes);
}
