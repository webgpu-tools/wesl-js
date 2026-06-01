import { integer, type MetricSection, metricSection } from "benchforge";

/** @return toDisplay fn that converts timing ms to lines/sec using metadata */
function msToLocSec(ms: number, metadata?: Record<string, unknown>): number {
  const lines = (metadata?.linesOfCode ?? metadata?.loc ?? 0) as number;
  return lines / (ms / 1000);
}

/** Lines/sec throughput: the primary verdict metric (higher is better). The
 *  mean drives the console headline + Δ% and the HTML shift-function fan; the
 *  line count rides along as an extra scalar cell. */
export const locSection: MetricSection = metricSection({
  title: "lines / sec",
  higherIsBetter: true,
  toDisplay: msToLocSec,
  formatter: integer,
  extras: [
    {
      key: "lines",
      title: "lines",
      formatter: integer,
      value: (_r, meta) => meta?.linesOfCode ?? meta?.loc,
    },
  ],
});
