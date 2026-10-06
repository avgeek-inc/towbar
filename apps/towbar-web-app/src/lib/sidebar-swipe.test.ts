import assert from "node:assert/strict";
import test from "node:test";
import { bindSidebarSwipe } from "@avgeek-oss/design-system/lib/sidebar-swipe";

class TouchSurface extends EventTarget {
  clientWidth = 390;
  scrollWidth = 390;
  parentElement: TouchSurface | null = null;
  interactive = false;
  closest() {
    return this.interactive ? this : null;
  }
}

function touchEvent(
  type: string,
  x: number,
  y: number,
  target: TouchSurface,
  count = 1,
  cancelable = true,
) {
  const event = new Event(type, { cancelable });
  Object.defineProperties(event, {
    target: { value: target },
    touches: {
      value: Array.from({ length: count }, (_, identifier) => ({
        identifier,
        clientX: x,
        clientY: y,
      })),
    },
  });
  return event;
}

test("sidebar swipe opens only for intentional rightward gestures and cleans up", () => {
  const originalElement = Object.getOwnPropertyDescriptor(
    globalThis,
    "Element",
  );
  const originalStyles = Object.getOwnPropertyDescriptor(
    globalThis,
    "getComputedStyle",
  );
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: TouchSurface,
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({ overflowX: "auto" }),
  });
  try {
    const root = new TouchSurface();
    let opened = 0;
    const unbind = bindSidebarSwipe(
      root as unknown as HTMLElement,
      () => opened++,
    );
    const gesture = (
      from: [number, number],
      to: [number, number],
      options: {
        target?: TouchSurface;
        count?: number;
        cancelable?: boolean;
        cancel?: boolean;
      } = {},
    ) => {
      const target = options.target ?? root;
      const start = touchEvent("touchstart", ...from, target);
      const move = touchEvent(
        "touchmove",
        ...to,
        target,
        options.count,
        options.cancelable,
      );
      root.dispatchEvent(start);
      root.dispatchEvent(move);
      root.dispatchEvent(
        new Event(options.cancel ? "touchcancel" : "touchend"),
      );
      assert.equal(start.defaultPrevented, false);
      return move.defaultPrevented;
    };
    assert.equal(gesture([20, 100], [110, 105]), true);
    assert.equal(opened, 1);
    assert.equal(gesture([20, 100], [23, 200]), false);
    assert.equal(gesture([20, 100], [0, 100]), false);
    assert.equal(gesture([120, 100], [240, 100]), false);
    gesture([20, 100], [40, 100]);
    gesture([20, 100], [120, 100], { cancel: true });
    assert.equal(gesture([20, 100], [120, 100], { count: 2 }), false);
    assert.equal(gesture([20, 100], [120, 100], { cancelable: false }), false);
    const control = new TouchSurface();
    control.interactive = true;
    assert.equal(gesture([20, 100], [120, 100], { target: control }), false);
    const table = new TouchSurface();
    table.parentElement = root;
    table.scrollWidth = 680;
    assert.equal(gesture([20, 100], [120, 100], { target: table }), false);
    assert.equal(opened, 1);
    unbind();
    assert.equal(gesture([20, 100], [120, 100]), false);
    assert.equal(opened, 1);
  } finally {
    if (originalElement)
      Object.defineProperty(globalThis, "Element", originalElement);
    else Reflect.deleteProperty(globalThis, "Element");
    if (originalStyles)
      Object.defineProperty(globalThis, "getComputedStyle", originalStyles);
    else Reflect.deleteProperty(globalThis, "getComputedStyle");
  }
});
