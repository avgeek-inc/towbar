"use client";
import { useEffect, useRef } from "react";
import { usePlotArea } from "recharts";

/** Imperative selection overlay: dragging never re-renders the chart series. */
export function ChartRangeSelection({
  domain,
  onSelect,
}: {
  domain: readonly [number, number];
  onSelect: (start: number, end: number) => void;
}) {
  const plot = usePlotArea();
  const overlay = useRef<SVGRectElement>(null);
  useEffect(() => {
    const rect = overlay.current,
      svg = rect?.ownerSVGElement;
    const root = svg?.closest<HTMLElement>("[data-range-chart]");
    if (!rect || !svg || !root || !plot) return;
    let drag: { x: number; id: number } | undefined;
    const coordinates = (event: PointerEvent) => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(matrix.inverse());
    };
    const clamp = (x: number) =>
      Math.max(plot.x, Math.min(plot.x + plot.width, x));
    const clear = () => {
      rect.setAttribute("width", "0");
      const pointer = drag?.id;
      drag = undefined;
      if (pointer !== undefined && root.hasPointerCapture(pointer))
        root.releasePointerCapture(pointer);
    };
    const down = (event: PointerEvent) => {
      if (
        !event.isPrimary ||
        event.button !== 0 ||
        (event.target instanceof Element &&
          event.target.closest("button,a,[role=button],foreignObject"))
      )
        return;
      const point = coordinates(event);
      if (
        !point ||
        point.x < plot.x ||
        point.x > plot.x + plot.width ||
        point.y < plot.y ||
        point.y > plot.y + plot.height
      )
        return;
      drag = { x: point.x, id: event.pointerId };
      root.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const point = coordinates(event);
      if (!point) return;
      const x = clamp(point.x);
      rect.setAttribute("x", String(Math.min(drag.x, x)));
      rect.setAttribute("width", String(Math.abs(x - drag.x)));
    };
    const up = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const point = coordinates(event),
        origin = drag.x;
      clear();
      if (!point) return;
      const x = clamp(point.x);
      if (Math.abs(x - origin) < 8) return;
      const at = (x: number) =>
        domain[0] + ((x - plot.x) / plot.width) * (domain[1] - domain[0]);
      const start = at(Math.min(x, origin)),
        end = at(Math.max(x, origin));
      if (end - start >= 30000) onSelect(start, end);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", clear);
    root.addEventListener("lostpointercapture", clear);
    window.addEventListener("keydown", key);
    return () => {
      clear();
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", clear);
      root.removeEventListener("lostpointercapture", clear);
      window.removeEventListener("keydown", key);
    };
  }, [plot, domain, onSelect]);
  return plot ? (
    <rect
      ref={overlay}
      x={plot.x}
      y={plot.y}
      width={0}
      height={plot.height}
      fill="var(--accent)"
      fillOpacity={0.16}
      stroke="var(--accent)"
      pointerEvents="none"
      aria-hidden="true"
    />
  ) : null;
}
