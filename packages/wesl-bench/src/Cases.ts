import type { LoadedCase } from "benchforge";
import { loadAllExamples, type WeslSource } from "./LoadExamples.ts";

/** Default cases (fast subset for quick benchmarks) */
export const defaultCases = ["bevy_env_map"];

/** Default variants (fast subset for quick benchmarks) */
export const defaultVariants = ["link"];

/** all examples, loaded once - loadAllExamples rereads every file from disk */
const examples = loadAllExamples();

/** All available benchmark cases */
export const cases = Object.keys(examples);

/** Load a benchmark case by ID */
export function loadCase(id: string): LoadedCase<WeslSource> {
  const source = examples[id];
  if (!source) throw new Error(`Unknown case: ${id}`);
  return { data: source, metadata: { loc: source.lineCount ?? 0 } };
}
