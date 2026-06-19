import type {
  AbstractElem,
  AttributeElem,
  BindingStructElem,
  FnElem,
  FnParamElem,
  ModuleElem,
  SimpleMemberRef,
  StructElem,
  SyntheticElem,
  TypeTemplateParameter,
} from "./AbstractElems.ts";
import type { TransformedAST, WeslJsPlugin } from "./Linker.ts";
import { visitAst } from "./LinkerUtil.ts";
import { debug } from "./Logging.ts";
import { findDecl } from "./LowerAndEmit.ts";
import { minimallyMangledName } from "./Mangler.ts";
import {
  attributeToString,
  contentsToString,
  typeListToString,
  typeParamToString,
} from "./RawEmit.ts";
import { textureStorage } from "./Reflection.ts";
import type { DeclIdent, Ident, RefIdent } from "./Scope.ts";
import { filterMap } from "./Util.ts";

export function bindingStructsPlugin(): WeslJsPlugin {
  return {
    transform: lowerBindingStructs,
  };
}

/**
 * Replace binding structs with binding variables, mutating (a clone of) the AST.
 *
 * A binding struct is one whose members carry `@group`/`@binding`. Each member
 * becomes a synthetic global var; references like `b.particles` are rewritten to
 * the new var, the intermediate `b: Bindings` params are dropped, and the struct
 * itself is removed.
 *
 * @return the mutated AST, with the binding structs recorded in notableElems.
 */
export function lowerBindingStructs(ast: TransformedAST): TransformedAST {
  const clonedAst = structuredClone(ast);
  const { moduleElem, globalNames, notableElems } = clonedAst;
  const bindingStructs = markBindingStructs(moduleElem); // CONSIDER should we only mark binding structs referenced from the entry point?
  markEntryTypes(moduleElem, bindingStructs);
  const newVars = bindingStructs.flatMap(s =>
    transformBindingStruct(s, globalNames),
  );
  const bindingRefs = findRefsToBindingStructs(moduleElem);

  // convert references 'b.particles' to references to the synthetic var 'particles'
  bindingRefs.forEach(({ memberRef, struct }) => {
    transformBindingReference(memberRef, struct);
  });
  // remove intermediate fn param declaration b:Bindings from 'fn(b:Bindings)'
  // by marking it skipped; emitFn drops skipped params.
  bindingRefs.forEach(({ intermediates }) => {
    intermediates.forEach(e => {
      e.skip = true;
    });
  });
  const contents = removeBindingStructs(moduleElem);
  moduleElem.contents = [...newVars, ...contents];
  notableElems.bindingStructs = bindingStructs;
  return { ...clonedAst, moduleElem };
}

export function markEntryTypes(
  moduleElem: ModuleElem,
  bindingStructs: BindingStructElem[],
): void {
  const fns = moduleElem.contents.filter(e => e.kind === "fn");
  const fnFound = fnReferencesBindingStruct(fns, bindingStructs);
  if (fnFound) {
    const { fn, struct } = fnFound;
    struct.entryFn = fn;
  }
}

function fnReferencesBindingStruct(
  fns: FnElem[],
  bindingStructs: BindingStructElem[],
): { fn: FnElem; struct: BindingStructElem } | undefined {
  for (const fn of fns) {
    const { params } = fn;
    for (const p of params) {
      const ref = p.name?.typeRef?.name as RefIdent | undefined;
      const referencedElem = (ref?.refersTo as DeclIdent)
        ?.declElem as StructElem;
      const struct = bindingStructs.find(s => s === referencedElem);
      if (struct) {
        return { fn, struct };
      }
    }
  }
}

function removeBindingStructs(moduleElem: ModuleElem): AbstractElem[] {
  return moduleElem.contents.filter(
    elem => elem.kind !== "struct" || !elem.bindingStruct,
  );
}

/** Mark and return structs with @group/@binding members as binding structs. */
export function markBindingStructs(
  moduleElem: ModuleElem,
): BindingStructElem[] {
  const structs = moduleElem.contents.filter(elem => elem.kind === "struct");
  const bindingStructs = structs.filter(containsBinding);
  bindingStructs.forEach(struct => {
    struct.bindingStruct = true;
  });
  // LATER also mark structs that reference a binding struct..
  return bindingStructs as BindingStructElem[];
}

/** @return true if any struct member is marked with @binding or @group */
function containsBinding(struct: StructElem): boolean {
  return struct.members.some(({ attributes }) => bindingAttribute(attributes));
}

function bindingAttribute(attributes?: AttributeElem[]): boolean {
  if (!attributes) return false;
  return attributes.some(
    ({ attribute }) =>
      attribute.kind === "@attribute" &&
      (attribute.name === "binding" || attribute.name === "group"),
  );
}

/** convert each member of the binding struct into a synthetic global variable */
export function transformBindingStruct(
  s: StructElem,
  globalNames: Set<string>,
): SyntheticElem[] {
  return s.members.map(member => {
    const { typeRef, name: memberName } = member;
    const { name: typeName } = typeRef!; // members should always have a typeRef.. LATER fix typing to show this
    const typeParameters = typeRef?.templateParams;

    const varName = minimallyMangledName(memberName.name, globalNames);
    member.mangledVarName = varName; // save new name so we can rewrite references to this member later
    globalNames.add(varName);

    const attributes =
      member.attributes?.map(attributeToString).join(" ") ?? "";
    const varTypes =
      lowerPtrMember(typeName, typeParameters) ??
      lowerStdTypeMember(typeName, typeParameters) ??
      lowerStorageTextureMember(typeName, typeParameters);
    if (!varTypes) {
      console.log("unhandled case transforming member", typeName);
      return syntheticVar(attributes, varName, "", "??");
    }

    const { storage: storageType, varType } = varTypes;
    return syntheticVar(attributes, varName, storageType, varType);
  });
}

interface LoweredVarTypes {
  storage: string;
  varType: string;
}

function lowerPtrMember(
  typeName: RefIdent,
  typeParameters: TypeTemplateParameter[] | undefined,
): LoweredVarTypes | undefined {
  if (typeName.originalName === "ptr") {
    const origParams = typeParameters ?? [];
    const newParams = [origParams[0]];
    if (origParams[2]) newParams.push(origParams[2]);
    const storage = typeListToString(newParams);

    const varType = typeParamToString(origParams?.[1]);
    return { storage, varType };
  }
}

function lowerStdTypeMember(
  typeName: RefIdent,
  typeParameters: TypeTemplateParameter[] | undefined,
): LoweredVarTypes | undefined {
  if (typeof typeName !== "string") {
    const varBaseType = typeName.std ? typeName.originalName : "??";
    const params = typeParameters ? typeListToString(typeParameters) : "";
    const varType = varBaseType + params;

    return { varType, storage: "" };
  }
}

function lowerStorageTextureMember(
  typeName: RefIdent,
  typeParameters: TypeTemplateParameter[] | undefined,
): LoweredVarTypes | undefined {
  if (textureStorage.test(typeName.originalName)) {
    const params = typeParameters ? typeListToString(typeParameters) : "";
    const varType = typeName + params;
    return { varType, storage: "" };
  }
}

function syntheticVar(
  attributes: string,
  varName: string,
  storageTemplate: string,
  varType: string,
): SyntheticElem {
  const text = `${attributes} var${storageTemplate} ${varName} : ${varType};\n`;
  return { kind: "synthetic", text };
}

interface MemberRefToStruct extends StructTrace {
  memberRef: SimpleMemberRef; // e.g. the memberRef 'b.particles'
}

interface StructTrace {
  struct: StructElem; // e.g. the struct Bindings
  intermediates: FnParamElem[]; // e.g. the fn param b:Bindings from 'fn(b:Bindings)'
}

/** find all simple member references in the module that refer to binding structs */
export function findRefsToBindingStructs(
  moduleElem: ModuleElem,
): MemberRefToStruct[] {
  const members: SimpleMemberRef[] = [];
  visitAst(moduleElem, elem => {
    if (elem.kind === "memberRef") members.push(elem);
  });
  return filterMap(members, refersToBindingStruct);
}

/** @return true if this memberRef refers to a binding struct */
function refersToBindingStruct(
  memberRef: SimpleMemberRef,
): MemberRefToStruct | undefined {
  const found = traceToStruct(memberRef.name.ident);

  if (found?.struct.bindingStruct) {
    return { memberRef, ...found };
  }
}

/** If this identifier ultimately refers to a struct type, return the struct declaration */
function traceToStruct(ident: RefIdent): StructTrace | undefined {
  const declElem = findDecl(ident).declElem;
  // LATER handle references other than fn parameters (e.g. a general traceToType()?)
  if (declElem?.kind !== "param") return undefined;

  const name = declElem.name.typeRef?.name;
  if (typeof name === "string" || name?.std) return undefined;

  const structElem = findDecl(name as Ident).declElem;
  if (structElem?.kind !== "struct") return undefined;
  return { struct: structElem, intermediates: [declElem] };
}

/** Mutate the member reference elem to instead contain synthetic elem text.
 * The new text is the mangled var name of the struct member that the memberRef refers to. */
export function transformBindingReference(
  memberRef: SimpleMemberRef,
  struct: StructElem,
): SyntheticElem {
  const refName = memberRef.member.name;
  const structMember = struct.members.find(m => m.name.name === refName)!;
  if (!structMember || !structMember.mangledVarName) {
    if (debug) console.log(`missing mangledVarName for ${refName}`);
    return { kind: "synthetic", text: refName };
  }
  const { extraComponents } = memberRef;
  const extraText = extraComponents ? contentsToString(extraComponents) : "";

  const text = structMember.mangledVarName + extraText;
  const synthElem: SyntheticElem = { kind: "synthetic", text };
  memberRef.contents = [synthElem];
  return synthElem;
}
