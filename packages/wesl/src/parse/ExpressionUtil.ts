import type {
  BinaryExpression,
  BinaryOperator,
  ComponentExpression,
  ComponentMemberExpression,
  ExpressionElem,
  FunctionCallExpression,
  Literal,
  NameElem,
  RefIdentElem,
  TypeRefElem,
  TypeTemplateParameter,
  UnaryExpression,
  UnaryOperator,
} from "../AbstractElems.ts";
import type { WeslToken } from "./WeslStream.ts";

export function makeLiteral(token: WeslToken<"keyword" | "number">): Literal {
  const { start, end } = token;
  return { kind: "literal", value: token.text, start, end };
}

export function makeUnaryOperator(token: WeslToken<"symbol">): UnaryOperator {
  const { start, end } = token;
  return { value: token.text as UnaryOperator["value"], start, end };
}

export function makeBinaryOperator(token: WeslToken): BinaryOperator {
  const value = token.text as BinaryOperator["value"];
  return { value, span: [token.start, token.end] };
}

export function makeUnaryExpression(
  operator: UnaryOperator,
  expr: ExpressionElem,
): UnaryExpression {
  return {
    kind: "unary-expression",
    operator,
    expression: expr,
    start: operator.start,
    end: expr.end,
  };
}

/**
 * Build left-associative binary expression from operator-operand pairs.
 * E.g., [a, [+, b], [*, c]] becomes ((a + b) * c).
 */
export function makeRepeatingBinaryExpression(
  first: ExpressionElem,
  rest: [BinaryOperator, ExpressionElem][],
): ExpressionElem {
  return rest.reduce<ExpressionElem>(
    (left, [op, right]): BinaryExpression => ({
      kind: "binary-expression",
      operator: op,
      left,
      right,
      start: left.start,
      end: right.end,
    }),
    first,
  );
}

export function makeBinaryExpression(
  left: ExpressionElem,
  operator: BinaryOperator,
  right: ExpressionElem,
): BinaryExpression {
  const { start } = left;
  return {
    kind: "binary-expression",
    operator,
    left,
    right,
    start,
    end: right.end,
  };
}

export function makeComponentExpression(
  base: ExpressionElem,
  access: ExpressionElem,
  end: number,
): ComponentExpression {
  return { kind: "component-expression", base, access, start: base.start, end };
}

export function makeComponentMemberExpression(
  base: ExpressionElem,
  access: NameElem,
): ComponentMemberExpression {
  return {
    kind: "component-member-expression",
    base,
    access,
    start: base.start,
    end: access.end,
  };
}

export function makeCallExpression(
  fn: RefIdentElem | TypeRefElem,
  templateArgs: TypeTemplateParameter[] | null,
  args: ExpressionElem[],
  end: number,
): FunctionCallExpression {
  return {
    kind: "call-expression",
    function: fn,
    templateArgs: templateArgs ?? undefined,
    arguments: args,
    start: fn.start,
    end,
  };
}
