import type { Config } from "tailwindcss";

// Instrument palette, not a dashboard palette.
//
// The chrome is deliberately achromatic: cool graphite surfaces, warm paper
// type. Every saturated colour on the board belongs to a team, so nothing
// competes with team identity for attention. Difficulty is encoded by weight
// (plain / outlined / filled) rather than by hue, which keeps the whole colour
// wheel free for the six teams and survives colour-blind viewers.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0E1113", // page ground
          900: "#14181B", // panel
          850: "#181D21", // row stripe
          800: "#1B2024", // raised
          700: "#262C31", // hairline
          600: "#363E44", // hairline, emphasised
        },
        paper: {
          DEFAULT: "#F2EFE9", // warm off-white against the cool ground
          dim: "#9AA1A6",
          faint: "#5C646A",
        },
      },
      fontFamily: {
        // Condensed industrial face for numbers and labels; the Chinese fallback
        // carries real names, which Barlow has no glyphs for.
        display: ['"Barlow Condensed"', '"Noto Sans TC"', "system-ui", "sans-serif"],
        sans: ['"Noto Sans TC"', '"Barlow Condensed"', "system-ui", "sans-serif"],
        // Verdict codes (AC / WA / TLE) are already a code vocabulary.
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        label: "0.22em",
      },
      transitionTimingFunction: {
        // Fast out, settle in — reads as a mechanism moving, not a spring.
        instrument: "cubic-bezier(0.2, 0, 0, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
