import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { dark_color, font, light_color, radius, spacing } from "./tokens";
import type { theme, theme_mode } from "./types";

// Theme context. The provider derives the mode from the OS color scheme and
// exposes the resolved token set. Consumers read it with use_theme.

const theme_context = createContext<theme | null>(null);

function build_theme(mode: theme_mode): theme {
  return {
    mode,
    color: mode === "dark" ? dark_color : light_color,
    spacing,
    radius,
    font,
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const mode: theme_mode = scheme === "dark" ? "dark" : "light";
  const value = useMemo(() => build_theme(mode), [mode]);
  return (
    <theme_context.Provider value={value}>{children}</theme_context.Provider>
  );
}

export function use_theme(): theme {
  const value = useContext(theme_context);
  if (!value) {
    throw new Error("use_theme must be used within ThemeProvider");
  }
  return value;
}
