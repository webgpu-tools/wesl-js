import { average, type MeasuredResults, type ReportSection, timeMs } from "benchforge";

/** Mean iteration time, shown as a single number per run (no CI chart),
 *  grouped with run-count rather than the lines/sec throughput section. */
export const meanTimeSection: ReportSection = {
  title: "time",
  columns: [
    {
      key: "meanTime",
      title: "mean",
      formatter: timeMs,
      comparable: true,
      value: (r: MeasuredResults) => (r.samples.length ? average(r.samples) : undefined),
    },
  ],
};
