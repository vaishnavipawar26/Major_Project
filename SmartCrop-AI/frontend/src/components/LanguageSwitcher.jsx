import { Languages } from "lucide-react";
import { LANGUAGES, useLanguage } from "../i18n/LanguageContext";

/** Language picker. Changes only the display language; it never touches form values or the current page. */
export default function LanguageSwitcher({ className = "", compact = false }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <label className={`lang-switch ${compact ? "is-compact" : ""} ${className}`}>
      <Languages size={17} aria-hidden="true" />
      <span className="sr-only">{t("lang.label")}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("lang.label")}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
