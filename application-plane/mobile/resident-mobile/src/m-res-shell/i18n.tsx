import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { strings_es } from "./strings_es";

// Language context. Holds the active app language and exposes a translate
// helper. The active language is UI state, independent of whether the backend
// profile write succeeds. Consumers read the language with useLang and
// translate visible English source strings with useT.

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

export function useLang(): lang_value {
  const value = useContext(lang_context);
  if (!value) {
    throw new Error("useLang must be used within LangProvider");
  }
  return value;
}

// Returns a translate function bound to the active language. English is the
// source; Spanish comes from strings_es. Strings with no entry fall back to the
// English source so untranslated text still renders.
export function useT(): (en: string) => string {
  const { lang } = useLang();
  return (en: string) => (lang === "es" && strings_es[en] ? strings_es[en] : en);
}
