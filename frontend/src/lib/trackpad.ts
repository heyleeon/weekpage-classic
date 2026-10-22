// Fingers on the trackpad, as macOS reports them (Rust `input://trackpad`, subscribed by
// hooks/useShellEvents.ts). Wheel events alone cannot tell fingers resting on the trackpad from
// fingers lifted; with this, two-finger swipes (usePageSwipe, SwipeRow) act on the lift and never
// while the fingers are down. null = nothing reported yet (Windows, the browser preview, before
// the first touch): the swipes then guess the lift from the wheel events.

type Listener = (touching: boolean) => void;

let touching: boolean | null = null;
const listeners = new Set<Listener>();

/** Fingers down (true), lifted (false), or no report (null). */
export function trackpadTouching(): boolean | null {
  return touching;
}

export function setTrackpadTouching(next: boolean): void {
  touching = next;
  for (const l of [...listeners]) l(next);
}

/** Called on every report (down and up); returns the unsubscribe. */
export function onTrackpadChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: back to "no report". */
export function resetTrackpad(): void {
  touching = null;
}
