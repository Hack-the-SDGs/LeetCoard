// Drawn marks, not glyphs. Symbol characters render as emoji on some platforms
// and at wildly different weights across fonts, so every icon here is an SVG
// that inherits currentColor.

interface IconProps {
  size?: number;
  className?: string;
}

export function DragHandle({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M1 3.5h10M1 6h10M1 8.5h10" />
    </svg>
  );
}

export function Cross({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  );
}

export function Plus({ size = 12, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M6 1.5v9M1.5 6h9" />
    </svg>
  );
}
