import type {
  color_tokens,
  font_tokens,
  radius_tokens,
  spacing_tokens,
} from "./types";

// Warm civic concierge design system. These tokens are the source of truth the
// UI mockup copies. Paper light / deep warm ink dark, pine-teal primary, warm
// clay accent, ~14px signature radius, 8pt spacing.

export const light_color: color_tokens = {
  paper: "#f7f2e9",
  surface: "#fffdf8",
  surface_raised: "#fffefb",
  ink: "#1c1a17",
  ink_muted: "#544f47",
  ink_subtle: "#8a8378",
  primary: "#1f5d52",
  primary_pressed: "#184a41",
  on_primary: "#f4fbf8",
  accent: "#d97742",
  accent_pressed: "#bd6133",
  on_accent: "#fff8f2",
  border: "#e6ddcc",
  border_strong: "#d4c8b2",
  focus_ring: "#2f8475",
  shadow: "rgba(28, 26, 23, 0.16)",
  grain: "rgba(124, 110, 86, 0.05)",
  scrim: "rgba(28, 26, 23, 0.42)",
};

export const dark_color: color_tokens = {
  paper: "#16140f",
  surface: "#211e18",
  surface_raised: "#2a261e",
  ink: "#f3ece0",
  ink_muted: "#c2b8a6",
  ink_subtle: "#8a8174",
  primary: "#56b3a2",
  primary_pressed: "#3f9888",
  on_primary: "#0c1f1b",
  accent: "#e89165",
  accent_pressed: "#d97742",
  on_accent: "#241208",
  border: "#3a352b",
  border_strong: "#4c4537",
  focus_ring: "#6fc7b6",
  shadow: "rgba(0, 0, 0, 0.5)",
  grain: "rgba(243, 236, 224, 0.035)",
  scrim: "rgba(0, 0, 0, 0.55)",
};

export const spacing: spacing_tokens = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius: radius_tokens = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
};

// Font keys match the @expo-google-fonts weights loaded in fonts.ts.
export const font: font_tokens = {
  display: "BricolageGrotesque_800ExtraBold",
  body: "HankenGrotesk_400Regular",
  mono: "JetBrainsMono_400Regular",
};
