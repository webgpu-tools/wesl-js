import type { SrcModule } from "./Scope.ts";
import { errorHighlight, offsetToLineNumber } from "./Util.ts";

/** Severity of a reported Diagnostic. */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A source-located message accumulated during compilation.
 *
 * Parsing collects diagnostics instead of throwing on the first syntax error,
 * so editors can report every problem in a module. Later pipeline stages
 * (binding, typing) report through the same shape.
 */
export interface Diagnostic {
  message: string;
  /** Start offset in the module source. */
  start: number;
  /** End offset in the module source. */
  end: number;
  severity: DiagnosticSeverity;
  /** Related source locations, e.g. "first declared here". */
  notes?: DiagnosticNote[];
}

/** A secondary source location attached to a Diagnostic. */
export interface DiagnosticNote {
  message: string;
  start: number;
  end: number;
}

/** Create an error-severity diagnostic. */
export function errorDiagnostic(
  message: string,
  start: number,
  end: number,
): Diagnostic {
  return { message, start, end, severity: "error" };
}

/** @return the first error-severity diagnostic, if any. */
export function firstError(diagnostics: Diagnostic[]): Diagnostic | undefined {
  return diagnostics.find(d => d.severity === "error");
}

/** Format a diagnostic for human reading:
 *  `file:line:col severity: message` plus a source-line highlight. */
export function diagnosticToString(
  diagnostic: Diagnostic,
  src: SrcModule,
): string {
  const { message, start, end, severity } = diagnostic;
  const [lineNum, linePos] = offsetToLineNumber(start, src.src);
  const highlight = errorHighlight(src.src, [start, end]).join("\n");
  return `${src.debugFilePath}:${lineNum}:${linePos} ${severity}: ${message}\n${highlight}`;
}
