import {
  integer,
  type MeasuredResults,
  type ReportSection,
  timeMs,
} from "benchforge";

/** @return toDisplay fn that converts timing ms to lines/sec using metadata */
function msToLocSec(ms: number, metadata?: Record<string, unknown>): number {
  const lines = (metadata?.linesOfCode ?? metadata?.loc ?? 0) as number;
  return lines / (ms / 1000);
}

export const locSection: ReportSection = {
  title: "lines / sec",
  columns: [
    {
      key: "locSecMean",
      title: "mean",
      statKind: "mean",
      toDisplay: msToLocSec,
      formatter: integer,
      comparable: true,
      higherIsBetter: true,
    },
    {
      key: "locSecP50",
      title: "p50",
      statKind: { percentile: 0.5 },
      toDisplay: msToLocSec,
      formatter: integer,
      comparable: true,
      higherIsBetter: true,
    },
    {
      key: "locSecMax",
      title: "max",
      statKind: "min",
      toDisplay: msToLocSec,
      formatter: integer,
      comparable: true,
      higherIsBetter: true,
    },
    {
      key: "meanTime",
      title: "mean time",
      statKind: "mean",
      formatter: timeMs,
      comparable: true,
    },
    {
      key: "lines",
      title: "lines",
      formatter: integer,
      value: (_r: MeasuredResults, meta?: Record<string, unknown>) =>
        meta?.linesOfCode ?? meta?.loc,
    },
  ],
};
