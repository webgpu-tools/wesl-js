import type {
  AbstractElem,
  AttributeElem,
  ElemWithAttributes,
  ElifAttribute,
  ElseAttribute,
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

  // @if attributes are evaluated based on conditions
  if (condAttribute.kind === "@if") {
    const result = evaluateIfAttribute(condAttribute, conditions); // LATER cache?
    return result;
  }

  // @elif attributes are evaluated based on conditions
  if (condAttribute.kind === "@elif") {
    const result = evaluateElifAttribute(condAttribute, conditions);
    return result;
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
    const cond = validateConditional(getCondAttr(item), elseValid, conditions);
    elseValid = cond.nextElseState;
    if (cond.valid) yield item;
  }
}

/**
 * Filter elements based on @if/@else conditional logic.
 * This function processes elements sequentially to handle @if/@else chains correctly.
 *
 * @param elements Array of elements at the same scope level
 * @param conditions Current conditional compilation settings
 * @return Array of valid elements after applying @if/@else logic
 */
export function filterValidElements<T extends AbstractElem>(
  elements: readonly T[],
  conditions: Conditions,
): T[] {
  let elseValid = false;

  return elements.flatMap(e => {
    const attributes = (e as ElemWithAttributes).attributes;
    const { valid, nextElseState } = validateAttributes(
      attributes,
      elseValid,
      conditions,
    );
    elseValid = nextElseState;
    return valid ? [e] : [];
  });
}

/**
 * Core logic for validating conditional attributes and managing @if/@elif/@else state.
 * @return valid: whether to process this element, nextElseState: state for next sibling
 */
export function validateConditional(
  condAttribute: IfAttribute | ElifAttribute | ElseAttribute | undefined,
  elseValid: boolean,
  conditions: Conditions,
): ConditionalResult {
  if (!condAttribute) {
    return { valid: true, nextElseState: elseValid };
  }

  if (condAttribute.kind === "@if") {
    const valid = evaluateIfAttribute(condAttribute, conditions);
    return { valid, nextElseState: !valid };
  } else if (condAttribute.kind === "@elif") {
    // @elif is only valid if no previous condition in the chain was true
    if (!elseValid) {
      // Previous condition was true, skip this @elif
      return { valid: false, nextElseState: false };
    }
    const valid = evaluateElifAttribute(condAttribute, conditions);
    return { valid, nextElseState: !valid };
  } else {
    // @else
    return { valid: elseValid, nextElseState: false };
  }
}

/**
 * Validate element based on attributes (or lack thereof).
 * @return valid if the element is valid under current Conditions and the next elseValid state
 * i.e. `@if(MOBILE) const x = 1;` is valid if MOBILE is true
 * Note that only elements marked with an @if or @else attribute can be invalid
 */
export function validateAttributes(
  attributes: AttributeElem[] | undefined,
  elseValid: boolean,
  conditions: Conditions,
): ConditionalResult {
  const condAttr = findConditional(attributes);
  return validateConditional(condAttr, elseValid, conditions);
}

/** Extract @if, @elif, or @else attribute from an array of attributes */
export function findConditional(
  attributes: AttributeElem[] | undefined,
): IfAttribute | ElifAttribute | ElseAttribute | undefined {
  if (!attributes) return;

  // Find first @if, @elif, or @else attribute
  for (const attr of attributes) {
    const kind = attr.attribute.kind;
    if (kind === "@if" || kind === "@elif" || kind === "@else") {
      return attr.attribute;
    }
  }
  return undefined;
}

/** @return true if the @if attribute is valid with current Conditions */
function evaluateIfAttribute(
  ifAttribute: IfAttribute,
  conditions: Conditions,
): boolean {
  return evaluateIfExpression(ifAttribute.param.expression, conditions);
}

/** @return true if the @elif attribute is valid with current Conditions */
function evaluateElifAttribute(
  elifAttribute: ElifAttribute,
  conditions: Conditions,
): boolean {
  return evaluateIfExpression(elifAttribute.param.expression, conditions);
}

/** Get conditional attribute from any scope item. */
function getCondAttr(item: ScopeItem): Scope["condAttribute"] {
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
