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

/** Flat translucent wash of a team colour, for fills behind type. */
export function teamWash(hex: string, alpha = 0.16): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return `rgba(242,239,233,${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
