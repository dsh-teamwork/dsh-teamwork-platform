/**
 * Collects what arrives between two frames and hands it over once per frame, for the app and the console alike. A
 * session's live output comes as many small events, often several in one task; applying each with its own render
 * costs a layout per delta, while the screen can only show one per frame anyway.
 */
export function frameBatch<T>(
  flush: (items: T[]) => void,
  schedule: (run: () => void) => unknown = (run) => requestAnimationFrame(run),
) {
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
