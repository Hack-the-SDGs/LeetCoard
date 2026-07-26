import { useEffect } from "react";

const SPEED_PX_PER_SEC = 26; // slow enough to read a name in passing
const PAUSE_MS = 2400;
/** Fast enough to read as a rewind rather than a second pass over the names. */
const REWIND_MS = 450;
/** Longest gap between frames that still counts as real elapsed time. */
const MAX_STEP_MS = 100;

type Phase = "hold-top" | "down" | "hold-bottom" | "rewind";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Walk a scroll container to the bottom, then rewind to the top and go again.
 *
 * The standings hold seventy students but a projector shows about twenty rows,
 * so the back half of the room would never see themselves. This carries them
 * past on a loop instead of asking anyone to touch a trackpad. The return trip
 * is a fast eased rewind rather than a slow scroll back: reading the list
 * upwards is not useful, and a hard jump reads as a glitch from across a room.
 *
 * The position is accumulated in a local rather than read back from the
 * element: at this speed a frame advances well under a pixel, and assigning a
 * sub-pixel `scrollTop` gets rounded away, so reading it back each frame would
 * lose every increment and the list would never move at all.
 */
export function useAutoScroll(ref: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let phase: Phase = "hold-top";
    let phaseStart = performance.now();
    let rewindFrom = 0;
    let position = el.scrollTop;
    let last = performance.now();

    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      // A hidden tab stops serving frames, so the first frame back reports the
      // whole absence as elapsed time. Uncapped, that lands the list at the
      // bottom in one jump. Cap at a few dropped frames' worth.
      const dt = Math.min(now - last, MAX_STEP_MS);
      last = now;

      // Rows come and go, so the travel distance is re-read every frame.
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= 1) return; // everyone already fits
      position = Math.min(position, overflow);

      switch (phase) {
        case "hold-top":
          if (now - phaseStart >= PAUSE_MS) {
            phase = "down";
          }
          break;

        case "down":
          position += (SPEED_PX_PER_SEC * dt) / 1000;
          if (position >= overflow) {
            position = overflow;
            phase = "hold-bottom";
            phaseStart = now;
          }
          break;

        case "hold-bottom":
          if (now - phaseStart >= PAUSE_MS) {
            phase = "rewind";
            phaseStart = now;
            rewindFrom = position;
          }
          break;

        case "rewind": {
          const t = Math.min(1, (now - phaseStart) / REWIND_MS);
          position = rewindFrom * (1 - easeOutCubic(t));
          if (t >= 1) {
            position = 0;
            phase = "hold-top";
            phaseStart = now;
          }
          break;
        }
      }

      el.scrollTop = position;
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ref, enabled]);
}
