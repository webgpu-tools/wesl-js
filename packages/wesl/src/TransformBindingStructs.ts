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
 * Transform binding structures into binding variables by mutating the AST.
 *
 * First we find all the binding structs:
 *   . find all the structs in the module by filtering the moduleElem.contents
 *     . for each struct:
 *       . mark any structs with that contain @group or @binding annotations as 'binding structs' and save them in a list
 *       . (later) create reverse links from structs to struct members
 *       . (later) visit all the binding structs and traverse to referencing structs, marking the referencing structs as binding structs too
 * Generate synethic AST nodes for binding variables
 *
 * Find all references to binding struct members
 *   . find the componound idents by traversing moduleElem.contents
 *   . filter to find the compound idents that refer to 'binding structs'
 *     . go from each ident to its declaration,
 *     . declaration to typeRef reference
 *     . typeRef to type declaration
 *     . check type declaration to see if it's a binding struct
 *     . record the intermediate declaration (e.g. a fn param b:Bindings from 'fn(b:Bindings)' )
 * rewrite references to binding struct members as synthetic elements
 *
 * Remove the binding structs from the AST
 * Remove the intermediate fn param declarations from the AST
 * Add the new binding variables to the AST
 *
 * @return the binding structs and the mutated AST
 */
export function lowerBindingStructs(ast: TransformedAST): TransformedAST {
  const clonedAst = structuredClone(ast);
  const { moduleElem, globalNames, notableElems } = clonedAst;
  const bindingStructs = markBindingStructs(moduleElem); // CONSIDER should we only mark bining structs referenced from the entry point?
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
  bindingRefs.forEach(({ intermediates }) => {
    intermediates.forEach(e => {
      e.contents = [];
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

/** mutate the AST, marking StructElems as bindingStructs
 *  (if they contain ptrs with @group @binding annotations)
 * @return the binding structs
 */
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

/** @return true if this struct contains a member with marked with @binding or @group */
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
  const varText = `${attributes} var${storageTemplate} ${varName} : ${varType};\n`;

  const elem: SyntheticElem = {
    kind: "synthetic",
    text: varText,
  };
  return elem;
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
  const decl = findDecl(ident);
  const declElem = decl.declElem;
  // for now only handle the case where the reference points at a fn parameter
  if (declElem && declElem.kind === "param") {
    const name = declElem.name.typeRef?.name;
    if (typeof name !== "string") {
      if (name?.std) {
        return undefined;
      }

      const paramDecl = findDecl(name as Ident);
      const structElem = paramDecl.declElem;
      if (structElem?.kind === "struct") {
        return { struct: structElem, intermediates: [declElem] };
      }
      return undefined;
    }
  } else {
    // LATER presumably handle other cases? Should this be more general, e.g. traceToType()?
    // elemLog(
    //   ident.refIdentElem!,
    //   `unhandled case in traceToStruct: decl ${declElem.kind} not yet implemented`,
    // );
  }
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
