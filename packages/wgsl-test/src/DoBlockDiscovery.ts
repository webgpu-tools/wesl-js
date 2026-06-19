import { type DoBlockElem, declsOfKind, type WeslAST } from "wesl";
import { findAnnotation } from "wesl-reflect";

export interface DoBlockInfo {
  name: string;
  /** Has `@test`: eligible for the wgsl-test runner. */
  isTest: boolean;
  /** Has `@entry`: marks the per-frame / canonical entry. */
  isEntry: boolean;
  block: DoBlockElem;
}

/** Find all `do` blocks in a parsed WESL module. */
export function findDoBlocks(ast: WeslAST): DoBlockInfo[] {
  return declsOfKind(ast.moduleElem, "do").map(block => ({
    name: block.name.name,
    isTest: !!findAnnotation(block, "test"),
    isEntry: !!findAnnotation(block, "entry"),
    block,
  }));
}

/** Subset that is runnable as a wgsl-test: `@test @entry`. */
export function findDoBlockTests(ast: WeslAST): DoBlockInfo[] {
  return findDoBlocks(ast).filter(d => d.isTest && d.isEntry);
}
