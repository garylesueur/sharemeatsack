// Nested overlays can unmount in either order. Restore the original page state
// only after the last owner releases it, rather than restoring another modal's
// temporary snapshot.
export function createOverlayOwnership<T extends { inert: boolean }>(style: { overflow: string }) {
  const nodes = new Map<T, { count: number; base: boolean }>();
  let bodyCount = 0,
    overflow = "";
  return {
    hold(elements: T[]) {
      const unique = [...new Set(elements)];
      for (const element of unique) {
        const state = nodes.get(element) ?? { count: 0, base: element.inert };
        state.count++;
        nodes.set(element, state);
        element.inert = true;
      }
      if (bodyCount++ === 0) {
        overflow = style.overflow;
        style.overflow = "hidden";
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const element of unique) {
          const state = nodes.get(element);
          if (state && --state.count === 0) {
            element.inert = state.base;
            nodes.delete(element);
          }
        }
        if (--bodyCount === 0) style.overflow = overflow;
      };
    },
  };
}
