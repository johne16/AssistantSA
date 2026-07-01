import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import { dark_color, font, light_color, radius, spacing } from "./tokens";
import type { theme, theme_mode } from "./types";

// Theme context. The provider resolves the mode from a manual override when set
// (the Settings dark-theme switch), otherwise from the OS color scheme. Consumers
// read the resolved tokens with useTheme and drive the override with
// useThemeMode.

const theme_context = createContext<theme | null>(null);

// null override means "follow the OS". A theme_mode override pins light or dark.
type theme_mode_value = {
  mode: theme_mode;
  override: theme_mode | null;
  set_override: (next: theme_mode | null) => void;
};

const theme_mode_context = createContext<theme_mode_value | null>(null);

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
  const [override, set_override] = useState<theme_mode | null>(null);
  const mode: theme_mode =
    override ?? (scheme === "dark" ? "dark" : "light");
  const value = useMemo(() => build_theme(mode), [mode]);
  const mode_value = useMemo<theme_mode_value>(
    () => ({ mode, override, set_override }),
    [mode, override],
  );
  return (
    <theme_mode_context.Provider value={mode_value}>
      <theme_context.Provider value={value}>{children}</theme_context.Provider>
    </theme_mode_context.Provider>
  );
}

export function useTheme(): theme {
  const value = useContext(theme_context);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}

// Read the resolved mode and pin or release the override (Settings appearance).
export function useThemeMode(): theme_mode_value {
  const value = useContext(theme_mode_context);
  if (!value) {
    throw new Error("useThemeMode must be used within ThemeProvider");
  }
  return value;
}
