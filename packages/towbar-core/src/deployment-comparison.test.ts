import assert from "node:assert/strict";
import test from "node:test";
import {
  compareMetricSummaries,
  summarizeComparisonMetric,
} from "./deployment-comparison.js";
const options = {
  regressionPercent: 20,
  minimumCoveragePercent: 80,
  absoluteFloor: 0.05,
  regression: true,
};
const summary = (average: number | null, coveragePercent = 100) => ({
  average,
  peak: average,
  coveragePercent,
  samples: 60,
});

void test("uses sample-weighted averages and preserved peaks across compaction", () => {
  const result = summarizeComparisonMetric(
    [
      {
        offsetSeconds: 0,
        metrics: { cpuCores: { sum: 1, count: 1, min: 1, max: 1 } },
      },
      {
        offsetSeconds: 60,
        metrics: { cpuCores: { sum: 8, count: 2, min: 3, max: 5 } },
      },
    ],
    "cpuCores",
    120,
  );
  assert.deepEqual(result, {
    average: 3,
    peak: 5,
    coveragePercent: 75,
    samples: 3,
  });
});
void test("insufficient coverage is not a healthy or stable comparison", () => {
  assert.equal(
    compareMetricSummaries(summary(1), summary(0, 5), options).assessment,
    "insufficient_data",
  );
  assert.equal(
    compareMetricSummaries(summary(null, 0), summary(0), options).assessment,
    "insufficient_data",
  );
});
void test("requires relative and absolute increases, handles zero baseline without infinity", () => {
  assert.equal(
    compareMetricSummaries(summary(1), summary(1.3), options).assessment,
    "increased",
  );
  assert.equal(
    compareMetricSummaries(summary(0.001), summary(0.01), options).assessment,
    "stable",
  );
  const zero = compareMetricSummaries(summary(0), summary(0.1), options);
  assert.equal(zero.assessment, "increased");
  assert.equal(zero.deltaPercent, null);
  assert.equal(
    compareMetricSummaries(summary(1), summary(0.7), options).assessment,
    "decreased",
  );
});
void test("higher traffic alone is informational rather than a performance regression", () => {
  assert.equal(
    compareMetricSummaries(summary(1), summary(50), {
      ...options,
      regression: false,
    }).assessment,
    "informational",
  );
});
