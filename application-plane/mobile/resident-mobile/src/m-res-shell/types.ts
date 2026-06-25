// m-res-shell owns its type definitions: the theme token shapes, the resolved
// city identity, and the app-launch input.

// Color tokens for one theme. Names match the design system in the UI mockup.
export interface color_tokens {
  paper: string;
  surface: string;
  surface_raised: string;
  ink: string;
  ink_muted: string;
  ink_subtle: string;
  primary: string;
  primary_pressed: string;
  on_primary: string;
  accent: string;
  accent_pressed: string;
  on_accent: string;
  border: string;
  border_strong: string;
  focus_ring: string;
  shadow: string;
  grain: string;
  scrim: string;
}

// Spacing scale (8pt base, tight 4 step) and corner radii.
export interface spacing_tokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface radius_tokens {
  sm: number;
  md: number;
  lg: number;
  pill: number;
}

// Brand face family names, resolved to loaded font keys.
export interface font_tokens {
  display: string;
  body: string;
  mono: string;
}

export type theme_mode = "light" | "dark";

export interface theme {
  mode: theme_mode;
  color: color_tokens;
  spacing: spacing_tokens;
  radius: radius_tokens;
  font: font_tokens;
}

// appLaunch input: the subdomain or parameters that identify the city, resolved
// before login.
export interface app_launch {
  subdomain: string | null;
  parameters: Record<string, string>;
}

// The city identity resolved from the subdomain against tenant_base_domain.
export interface city_identity {
  city_tenant_id: string;
  subdomain: string | null;
}

export interface shell_config {
  tenant_base_domain: string;
}
