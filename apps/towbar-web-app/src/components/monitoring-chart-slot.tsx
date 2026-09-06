"use client";

import { memo, startTransition, useEffect, useRef, useState } from "react";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { MetricChart, type MetricChartProps } from "./monitoring-metric-chart";

// Give the browser a paint/input opportunity between chart commits. A single
// queue also prevents all visible charts starting work in the same frame.
const updates = new Set<() => void>();
let scheduled = false;
function drainUpdates() {
  if (scheduled || !updates.size) return;
  scheduled = true;
  requestAnimationFrame(() => {
    setTimeout(() => {
      const next = updates.values().next().value;
      if (next) {
        updates.delete(next);
        startTransition(next);
      }
      scheduled = false;
      drainUpdates();
    }, 0);
  });
}
function scheduleUpdate(update: () => void) {
  updates.add(update);
  drainUpdates();
  return () => {
    updates.delete(update);
  };
}

export const MonitoringChartSlot = memo(function MonitoringChartSlot(
  props: MetricChartProps,
) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [snapshot, setSnapshot] = useState<MetricChartProps>();
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { rootMargin: "100px" },
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    return scheduleUpdate(() => setSnapshot(props));
  }, [props, visible]);
  return (
    <div ref={element} className="min-w-0" aria-busy={snapshot !== props}>
      {snapshot ? (
        <MetricChart {...snapshot} />
      ) : (
        <Widget>
          <Widget.Header>
            <Widget.Title>
              {props.metrics.length === 1
                ? props.metrics[0]!.label
                : props.metrics[0]!.key.startsWith("network")
                  ? "Network traffic"
                  : "Disk I/O"}
            </Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <div className="h-[220px]" aria-label="Loading chart" />
            {props.metrics.length > 1 ? <div className="mt-2 h-5" /> : null}
          </Widget.Content>
        </Widget>
      )}
    </div>
  );
});
