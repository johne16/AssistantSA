import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { strings_es } from "./strings_es";

// Language context. Holds the active app language and exposes a translate
// helper. The active language is UI state, independent of whether the backend
// profile write succeeds. Consumers read the language with use_lang and
// translate visible English source strings with use_t.

type lang = "en" | "es";

type lang_value = {
  lang: lang;
  set_lang: (next: lang) => void;
};

const lang_context = createContext<lang_value | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set_lang_state] = useState<lang>("en");
  const value = useMemo<lang_value>(
    () => ({ lang, set_lang: (next) => set_lang_state(next) }),
    [lang],
  );
  return <lang_context.Provider value={value}>{children}</lang_context.Provider>;
}

export function use_lang(): lang_value {
  const value = useContext(lang_context);
  if (!value) {
    throw new Error("use_lang must be used within LangProvider");
  }
  return value;
}

// Returns a translate function bound to the active language. English is the
// source; Spanish comes from strings_es. Strings with no entry fall back to the
// English source so untranslated text still renders.
export function use_t(): (en: string) => string {
  const { lang } = use_lang();
  return (en: string) => (lang === "es" && strings_es[en] ? strings_es[en] : en);
}
