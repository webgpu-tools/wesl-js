import { expect, test } from "vitest";
import {
  conditionalTranslationCases,
  importCases,
  importSyntaxCases,
} from "wesl-testsuite";
import type { AbstractElem } from "../AbstractElems.ts";
import { childElems } from "../LinkerUtil.ts";
import { parseWESL } from "./TestUtil.ts";

type Positioned = Exclude<AbstractElem, { kind: "synthetic" }>;

/**
 * Comment attachment (AttachComments.ts) walks the tree with forward-only
 * cursors, relying on every node's positioned children having disjoint spans
 * that lie inside the parent's span. A parser change that emits a nested or
 * overlapping child span would silently misattach comments, so this test
 * asserts the invariant over a syntax-rich corpus.
 */

/** every statement/expression/declaration form in one module */
const richSource = `
  import package::other::{a1, b1 as b2};
  enable f16;
  diagnostic(warning, derivative_uniformity);

  const two = 2;
  override speed: f32 = 1.5;
  alias Vec = vec3<f32>;
  var<storage, read_write> buf: array<f32, two>;

  @if(FLAG) const flagged = 1;
  @elif(OTHER) const flagged = 2;
  @else const flagged = 3;

  struct Light {
    @align(16) pos: vec3<f32>,
    @if(COLOR) color: vec4<f32>,
    intensity: f32,
  }

  const_assert two > 1;

  @compute @workgroup_size(two, 1, 1)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    var x = 0;
    let l = Light(vec3(0.0), 1.0);
    _ = l.intensity + f32(x);
    x++;
    x -= two;
    if x > 1 {
      x = 1;
    } else if x < 0 {
      x = 0;
    } else {
      discard;
    }
    switch x {
      case 0, 1: { x = 2; }
      default: { x = 3; }
    }
    for (var i = 0; i < 4; i++) {
      if i == 2 { continue; }
      x += select(0, 1, buf[u32(i)] > 0.0 && x < 9);
    }
    while x > 0 { x -= 1; }
    loop {
      x += 1;
      break if x > 3;
      continuing {
        const_assert two > 0;
      }
    }
    @if(FLAG) { let y = helper(x); _ = y; }
    ;
    @if(FLAG) ;
    return;
  }

  fn helper(n: i32) -> i32 {
    return select(n, -n, n < 0);
  }
`;

const caseSources = [...importCases, ...conditionalTranslationCases]
  .flatMap(c => Object.entries(c.weslSrc))
  .map(([path, src]) => ({ name: path, src }));

function positionedChildren(elem: Positioned): Positioned[] {
  return childElems(elem)
    .filter((e): e is Positioned => e.kind !== "synthetic")
    .toSorted((a, b) => a.start - b.start);
}

/** Collect span-invariant violations over the whole tree: every positioned
 *  child within its parent's span, and sibling spans disjoint. */
function spanViolations(root: Positioned): string[] {
  const violations: string[] = [];
  const visit = (node: Positioned): void => {
    const children = positionedChildren(node);
    let prevEnd = node.start;
    let prevKind = "(parent start)";
    for (const child of children) {
      if (child.start < node.start || child.end > node.end) {
        violations.push(
          `${child.kind} [${child.start},${child.end}] outside ` +
            `${node.kind} [${node.start},${node.end}]`,
        );
      }
      if (child.start < prevEnd) {
        violations.push(
          `${child.kind} [${child.start},${child.end}] overlaps ` +
            `${prevKind} ending at ${prevEnd} in ${node.kind}`,
        );
      }
      prevEnd = child.end;
      prevKind = child.kind;
      visit(child);
    }
  };
  visit(root);
  return violations;
}

test("sibling spans are disjoint and nested in parents (rich source)", () => {
  const ast = parseWESL(richSource);
  expect(ast.diagnostics).toEqual([]); // parse errors would shrink coverage
  expect(spanViolations(ast.moduleElem)).toEqual([]);
});

test("sibling spans are disjoint and nested in parents (shared test cases)", () => {
  for (const { name, src } of caseSources) {
    const ast = parseWESL(src);
    const violations = spanViolations(ast.moduleElem);
    expect(violations, name).toEqual([]);
  }
  for (const { src, fails } of importSyntaxCases) {
    if (fails) continue;
    const ast = parseWESL(src);
    expect(spanViolations(ast.moduleElem), src).toEqual([]);
  }
});
