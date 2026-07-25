import { useEffect } from "react";

const SPEED_PX_PER_SEC = 22; // slow enough to read a name in passing
const PAUSE_MS = 2400;

/**
 * Walk a scroll container down and back up, forever.
 *
 * The standings hold 70 students but a projector shows about 20 rows, so the
 * back half of the room would never see themselves. This carries them past on
 * a loop instead of asking anyone to touch a trackpad. Reverses at the ends
 * rather than jumping, because a jump reads as a glitch from across a room.
 */
export function useAutoScroll(ref: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let direction: 1 | -1 = 1;
    let pausedUntil = performance.now() + PAUSE_MS;
    let last = performance.now();

    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      const dt = now - last;
      last = now;

      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= 1) return; // everyone already fits
      if (now < pausedUntil) return;

      el.scrollTop += (direction * SPEED_PX_PER_SEC * dt) / 1000;

      if (direction === 1 && el.scrollTop >= overflow - 0.5) {
        el.scrollTop = overflow;
        direction = -1;
        pausedUntil = now + PAUSE_MS;
      } else if (direction === -1 && el.scrollTop <= 0.5) {
        el.scrollTop = 0;
        direction = 1;
        pausedUntil = now + PAUSE_MS;
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ref, enabled]);
}
