type Swipe = {
  identifier: number;
  x: number;
  y: number;
  claimed: boolean;
  distance: number;
};

function hasHorizontalScroll(target: Element, root: HTMLElement) {
  for (
    let element: Element | null = target;
    element && element !== root;
    element = element.parentElement
  ) {
    if (
      element.scrollWidth > element.clientWidth &&
      /auto|scroll/.test(getComputedStyle(element).overflowX)
    )
      return true;
  }
  return false;
}

export function bindSidebarSwipe(root: HTMLElement, open: () => void) {
  let swipe: Swipe | null = null;
  const start = (event: TouchEvent) => {
    swipe = null;
    const touch = event.touches[0];
    const target = event.target;
    if (
      event.touches.length !== 1 ||
      !touch ||
      touch.clientX > 64 ||
      !(target instanceof Element) ||
      target.closest(
        'a, button, input, textarea, select, [contenteditable], [role="slider"], [role="dialog"], [role="listbox"], canvas, .recharts-wrapper, .xterm',
      ) ||
      hasHorizontalScroll(target, root)
    )
      return;
    swipe = {
      identifier: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      claimed: false,
      distance: 0,
    };
  };
  const move = (event: TouchEvent) => {
    if (!swipe) return;
    const touch = event.touches[0];
    if (
      event.touches.length !== 1 ||
      !touch ||
      touch.identifier !== swipe.identifier ||
      !event.cancelable
    ) {
      swipe = null;
      return;
    }
    const x = touch.clientX - swipe.x;
    const y = Math.abs(touch.clientY - swipe.y);
    if (!swipe.claimed) {
      if ((y > 12 && y >= Math.abs(x)) || x < -12) {
        swipe = null;
        return;
      }
      if (x < 12 || x < y * 2) return;
      swipe.claimed = true;
    }
    event.preventDefault();
    swipe.distance = x;
  };
  const end = () => {
    const completed = swipe?.claimed && swipe.distance >= 64;
    swipe = null;
    if (completed) open();
  };
  const cancel = () => {
    swipe = null;
  };
  root.addEventListener("touchstart", start, { passive: true });
  root.addEventListener("touchmove", move, { passive: false });
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", cancel);
  return () => {
    root.removeEventListener("touchstart", start);
    root.removeEventListener("touchmove", move);
    root.removeEventListener("touchend", end);
    root.removeEventListener("touchcancel", cancel);
  };
}
