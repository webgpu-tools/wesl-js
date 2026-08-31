import type {
  AbstractElem,
  AttributeElem,
  ConditionalAttribute,
  ElemWithAttributes,
  ElifAttribute,
  ExpressionElem,
  IfAttribute,
} from "./AbstractElems.ts";
import { assertThatDebug, assertUnreachable } from "./Assertions.ts";
import type { Conditions, Scope, ScopeItem } from "./Scope.ts";

/** @public */
export interface ConditionalResult {
  valid: boolean;
  nextElseState: boolean;
}

/** @return true if the scope is valid under current conditions */
export function scopeValid(scope: Scope, conditions: Conditions): boolean {
  const { condAttribute } = scope;
  if (!condAttribute) return true;

  // @if and @elif attributes are evaluated based on conditions
  if (condAttribute.kind === "@if" || condAttribute.kind === "@elif") {
    return evaluateCondAttribute(condAttribute, conditions); // LATER cache?
  }

  // @else attributes are never valid on their own (need parent context)
  return false;
}

/** Iterate scope contents, yielding only conditionally valid items. */
export function* validScopeItems(
  scope: Scope,
  conditions: Conditions,
): Generator<ScopeItem> {
  let elseValid = false;
  for (const item of scope.contents) {
    const condAttr = getCondAttr(item);
    if (!condAttr) {
      // common case: unconditional item, and elseValid carries over unchanged
      yield item;
    } else {
      const cond = validateConditional(condAttr, elseValid, conditions);
      elseValid = cond.nextElseState;
      if (cond.valid) yield item;
    }
  }
}

/**
 * Filter elements to those valid under the current conditions.
 * @param elements sibling elements at one scope level, in source order -
 *   an @if/@elif/@else chain is only read correctly in sequence
 */
export function filterValidElements<T extends AbstractElem>(
  elements: readonly T[],
  conditions: Conditions,
): T[] {
  let elseValid = false;
  const valid: T[] = [];
  for (const e of elements) {
    const condAttr = findConditional((e as ElemWithAttributes).attributes);
    if (!condAttr) {
      // common case: unconditional element, and elseValid carries over unchanged
      valid.push(e);
    } else {
      const cond = validateConditional(condAttr, elseValid, conditions);
      elseValid = cond.nextElseState;
      if (cond.valid) valid.push(e);
    }
  }
  return valid;
}

/**
 * Core logic for validating conditional attributes and managing @if/@elif/@else state.
 * @return valid: whether to process this element, nextElseState: state for next sibling
 */
export function validateConditional(
  condAttribute: ConditionalAttribute | undefined,
  elseValid: boolean,
  conditions: Conditions,
): ConditionalResult {
  if (!condAttribute) {
    return { valid: true, nextElseState: elseValid };
  }

  if (condAttribute.kind === "@if") {
    const valid = evaluateCondAttribute(condAttribute, conditions);
    return { valid, nextElseState: !valid };
  } else if (condAttribute.kind === "@elif") {
    // @elif is only valid if no previous condition in the chain was true
    if (!elseValid) {
      // Previous condition was true, skip this @elif
      return { valid: false, nextElseState: false };
    }
    const valid = evaluateCondAttribute(condAttribute, conditions);
    return { valid, nextElseState: !valid };
  } else {
    // @else
    return { valid: elseValid, nextElseState: false };
  }
}

/** Extract @if, @elif, or @else attribute from an array of attributes */
export function findConditional(
  attributes: AttributeElem[] | undefined,
): ConditionalAttribute | undefined {
  if (!attributes) return;

  for (const attr of attributes) {
    const kind = attr.attribute.kind;
    if (kind === "@if" || kind === "@elif" || kind === "@else") {
      return attr.attribute;
    }
  }
  return undefined;
}

/** @return true if an @if or @elif attribute is valid with current Conditions */
function evaluateCondAttribute(
  attribute: IfAttribute | ElifAttribute,
  conditions: Conditions,
): boolean {
  return evaluateIfExpression(attribute.param.expression, conditions);
}

/** Get conditional attribute from any scope item. */
function getCondAttr(item: ScopeItem): ConditionalAttribute | undefined {
  // Decls inside PartialScopes don't need their own conditional checked -
  // the PartialScope.condAttribute handles filtering at the scope level.
  if (item.kind === "decl" && item.containingScope.kind === "partial")
    return undefined;
  if (item.kind === "decl") return findConditional(item.declElem?.attributes);
  if (item.kind === "partial" || item.kind === "scope")
    return item.condAttribute;
  return undefined;
}

/** Evaluate an @if expression based on current runtime Conditions
 * @return true if the expression is true */
function evaluateIfExpression(
  expression: ExpressionElem,
  conditions: Conditions,
): boolean {
  const { kind } = expression;
  if (kind === "unary-expression") {
    assertThatDebug(expression.operator.value === "!");
    return !evaluateIfExpression(expression.expression, conditions);
  } else if (kind === "binary-expression") {
    const op = expression.operator.value;
    assertThatDebug(op === "||" || op === "&&");
    const leftResult = evaluateIfExpression(expression.left, conditions);
    if (op === "||") {
      return leftResult || evaluateIfExpression(expression.right, conditions);
    } else if (op === "&&") {
      return leftResult && evaluateIfExpression(expression.right, conditions);
    } else {
      assertUnreachable(op);
    }
  } else if (kind === "literal") {
    const { value } = expression;
    assertThatDebug(value === "true" || value === "false");
    return value === "true";
  } else if (kind === "parenthesized-expression") {
    return evaluateIfExpression(expression.expression, conditions);
  } else if (kind === "ref") {
    return conditions[expression.ident.originalName] ?? false;
  } else {
    throw new Error(`unexpected @if expression ${JSON.stringify(expression)}`);
  }
}
