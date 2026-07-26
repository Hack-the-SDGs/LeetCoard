import type { GroupPayload } from "./types";

// Colour on this board means one thing only: which team you are on. Difficulty
// is carried by weight instead (see DifficultyMark), which leaves the whole
// wheel to the six teams and keeps the board readable without colour vision.

export const UNASSIGNED_COLOR = "#5C646A";

export type TeamColors = Map<number, string>;

export function teamColors(groups: GroupPayload[]): TeamColors {
  return new Map(groups.map((g) => [g.id, g.color]));
}

export function teamColor(groupId: number | null | undefined, colors: TeamColors): string {
  if (groupId == null) return UNASSIGNED_COLOR;
  return colors.get(groupId) ?? UNASSIGNED_COLOR;
}

function rgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const parts: [number, number, number] = [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
  return parts.some(Number.isNaN) ? null : parts;
}

/** Flat translucent wash of a team colour, for fills behind type. */
export function teamWash(hex: string, alpha = 0.16): string {
  const parts = rgb(hex);
  if (!parts) return `rgba(242,239,233,${alpha})`;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}

const INK = "#0E1113";
const PAPER = "#F2EFE9";

/**
 * Ink or paper, whichever stays legible on this team colour.
 *
 * Teams pick their own hex in the console, and a dark pick (a deep purple, a
 * teal) leaves near-black type at about 2.7:1 — fine on a laptop, gone from the
 * back of a lecture hall. Compares WCAG contrast against both and takes the
 * winner rather than assuming every team colour is bright.
 */
export function readableInk(hex: string): string {
  const parts = rgb(hex);
  if (!parts) return INK;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]);
  // Ink wins while (lum + .05)/INK_L ≥ PAPER_L/(lum + .05); squared to skip the
  // divide. INK_L and PAPER_L are the two constants' own relative luminance + .05.
  const INK_L = 0.056;
  const PAPER_L = 0.915;
  return (lum + 0.05) ** 2 >= INK_L * PAPER_L ? INK : PAPER;
}
