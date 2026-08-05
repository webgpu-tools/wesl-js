import { identToString } from "./debug/ScopeToString.ts";
import type { DeclIdent } from "./Scope.ts";

/** decls currently visible in this scope */
export interface LiveDecls {
  /** decls currently visible in this scope */
  decls: Map<string, DeclIdent>;

  /** live decls in the parent scope. null for the modue root scope */
  parent?: LiveDecls | null;
}

/** create a LiveDecls */
export function makeLiveDecls(parent: LiveDecls | null = null): LiveDecls {
  return { decls: new Map<string, DeclIdent>(), parent };
}

/** create a root LiveDecls with the provided decls indexed by name */
export function makeRootLiveDecls(decls: DeclIdent[]): LiveDecls {
  return { decls: new Map(decls.map(d => [d.originalName, d])), parent: null };
}

/** debug routine for logging LiveDecls */
export function liveDeclsToString(liveDecls: LiveDecls): string {
  const { decls, parent } = liveDecls;
  const declsStr = Array.from(decls.entries())
    .map(([name, decl]) => `${name}:${identToString(decl)}`)
    .join(", ");
  const parentStr = parent ? liveDeclsToString(parent) : "null";
  return `decls: { ${declsStr} }, parent: ${parentStr}`;
}

/*
LATER try not creating a map for small scopes. 
Instead just track the current live index in the scope array.
*/
