import type {
  color_tokens,
  font_tokens,
  radius_tokens,
  spacing_tokens,
} from "./types";

// "The quiet line" design system, mirrored from design/new_concept/mockup.html.
// Bone paper, deep-indigo primary listener, one burnt-amber signal, a danger
// tier for life-safety. accent* keys alias the signal trio for back-compat.

export const light_color: color_tokens = {
  paper: "#edebe4",
  surface: "#f8f7f2",
  surface_raised: "#fcfbf7",
  ink: "#15161b",
  ink_muted: "#54555e",
  ink_subtle: "#8a8b92",
  primary: "#2c2b63",
  primary_pressed: "#211f4d",
  on_primary: "#f3f2fb",
  primary_soft: "rgba(44, 43, 99, 0.10)",
  signal: "#d9881f",
  signal_pressed: "#bd7212",
  on_signal: "#241402",
  signal_soft: "rgba(217, 136, 31, 0.13)",
  accent: "#d9881f",
  accent_pressed: "#bd7212",
  on_accent: "#241402",
  danger: "#bf3322",
  on_danger: "#fff2ef",
  danger_soft: "rgba(191, 51, 34, 0.10)",
  border: "#ddd9ce",
  border_strong: "#c9c4b5",
  focus_ring: "#5856c0",
  shadow: "rgba(21, 22, 27, 0.13)",
  grain: "rgba(90, 84, 64, 0.045)",
  scrim: "rgba(21, 22, 27, 0.42)",
};

export const dark_color: color_tokens = {
  paper: "#101117",
  surface: "#181a22",
  surface_raised: "#1f222c",
  ink: "#ececf1",
  ink_muted: "#a9aab4",
  ink_subtle: "#74757f",
  primary: "#8a88f0",
  primary_pressed: "#6f6de0",
  on_primary: "#0b0b1a",
  primary_soft: "rgba(138, 136, 240, 0.14)",
  signal: "#e8a33d",
  signal_pressed: "#d9881f",
  on_signal: "#1a0e00",
  signal_soft: "rgba(232, 163, 61, 0.15)",
  accent: "#e8a33d",
  accent_pressed: "#d9881f",
  on_accent: "#1a0e00",
  danger: "#f0816a",
  on_danger: "#1f0a06",
  danger_soft: "rgba(240, 129, 106, 0.15)",
  border: "#2a2c36",
  border_strong: "#3a3d49",
  focus_ring: "#8a88f0",
  shadow: "rgba(0, 0, 0, 0.5)",
  grain: "rgba(236, 236, 241, 0.03)",
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
  sm: 9,
  md: 16,
  lg: 22,
  pill: 999,
};

// Font keys match the @expo-google-fonts weights loaded in fonts.ts.
export const font: font_tokens = {
  display: "SpaceGrotesk_700Bold",
  body: "HankenGrotesk_400Regular",
  mono: "JetBrainsMono_400Regular",
};
