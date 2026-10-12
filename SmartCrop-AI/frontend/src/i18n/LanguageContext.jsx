import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { setFormatLanguage } from "../utils/format";
import en from "./en";
import hi from "./hi";
import mr from "./mr";

// Dictionaries by language code; a key missing in mr/hi falls back to English.
const DICTIONARIES = { en, mr, hi };
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "mr", label: "मराठी" },
  { code: "hi", label: "हिन्दी" },
];
const STORAGE_KEY = "smartcrop_lang";

const readLang = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return DICTIONARIES[v] ? v : "en";
  } catch { return "en"; }
};

/** Look up `key` (active language → English → the key itself) and fill {placeholders} from `vars`. */
export function translate(lang, key, vars) {
  const raw = DICTIONARIES[lang]?.[key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : raw;
}

const makeValue = (lang, setLang) => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) });

// The default value keeps every component working (in English) even without the provider.
export const LanguageContext = createContext(makeValue("en", () => {}));

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => { const l = readLang(); setFormatLanguage(l); return l; });
  const setLang = useCallback((code) => {
    if (!DICTIONARIES[code]) return;
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage unavailable */ }
    setFormatLanguage(code);
    setLangState(code);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo(() => makeValue(lang, setLang), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
export const useT = () => useContext(LanguageContext).t;

/** Translate a known fixed message (from the server or the API client) by its exact English text, else return it unchanged. */
export function knownMessage(t, text) {
  if (typeof text !== "string" || !text) return { text, translated: false };
  const key = `known.${text.trim()}`;
  const v = t(key);
  return v === key ? { text, translated: false } : { text: v, translated: true };
}
export function useKnownMessage() {
  const t = useT();
  return (text) => knownMessage(t, text).text;
}
