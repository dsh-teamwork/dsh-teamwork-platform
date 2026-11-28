/**
 * Collects what arrives between two frames and hands it over once per frame, for the app and the console alike. A
 * session's live output comes as many small events, often several in one task; applying each with its own render
 * costs a layout per delta, while the screen can only show one per frame anyway.
 */
/** How often a page that is not shown hands over what waits: it draws no frames, and a backlog would only grow. */
export const HIDDEN_FLUSH_MS = 250;

/** The next frame, or, where the page is hidden and draws none, a short while. */
function nextFrame(run: () => void) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return setTimeout(run, HIDDEN_FLUSH_MS);
  return requestAnimationFrame(run);
}

export function frameBatch<T>(flush: (items: T[]) => void, schedule: (run: () => void) => unknown = nextFrame) {
  let items: T[] = [];
  let scheduled = false;
  let stopped = false;
  const handOver = () => {
    if (stopped || !items.length) return;
    const batch = items;
    items = [];
    flush(batch);
  };
  return {
    push(item: T) {
      if (stopped) return;
      items.push(item);
      if (scheduled) return;
      scheduled = true;
      schedule(() => {
        scheduled = false;
        handOver();
      });
    },
    /** Hands over what waits now, for something the screen must show at once. */
    flush: handOver,
    /** Nothing waiting is handed over any more. */
    stop() {
      stopped = true;
      items = [];
    },
  };
}
