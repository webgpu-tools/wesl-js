import type {
  AbstractElem,
  AttributeElem,
  BindingStructElem,
  FnElem,
  ModuleElem,
  StructElem,
  SyntheticElem,
  TypeTemplateParameter,
} from "./AbstractElems.ts";
import type { TransformedAST, WeslJsPlugin } from "./Linker.ts";
import { minimallyMangledName } from "./Mangler.ts";
import {
  attributeToString,
  typeListToString,
  typeParamToString,
} from "./RawEmit.ts";
import { textureStorage } from "./Reflection.ts";
import type { DeclIdent, RefIdent } from "./Scope.ts";

interface LoweredVarTypes {
  storage: string;
  varType: string;
}

export function bindingStructsPlugin(): WeslJsPlugin {
  return {
    transform: lowerBindingStructs,
  };
}

/**
 * Replace binding structs with binding variables, mutating (a clone of) the AST.
 *
 * A binding struct is one whose members carry `@group`/`@binding`. Each member
 * becomes a synthetic global var and the struct itself is removed.
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
    member.mangledVarName = varName; // record the synthesized var's name on the member
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

function removeBindingStructs(moduleElem: ModuleElem): AbstractElem[] {
  return moduleElem.contents.filter(
    elem => elem.kind !== "struct" || !elem.bindingStruct,
  );
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

/** @return true if any struct member is marked with @binding or @group */
function containsBinding(struct: StructElem): boolean {
  return struct.members.some(({ attributes }) => bindingAttribute(attributes));
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

function bindingAttribute(attributes?: AttributeElem[]): boolean {
  if (!attributes) return false;
  return attributes.some(
    ({ attribute }) =>
      attribute.kind === "@attribute" &&
      (attribute.name === "binding" || attribute.name === "group"),
  );
}
