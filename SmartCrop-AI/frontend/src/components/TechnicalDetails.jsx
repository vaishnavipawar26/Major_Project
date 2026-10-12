import { Microscope } from "lucide-react";
import { useT } from "../i18n/LanguageContext";

/** Collapsed section for SHAP values, model names and other details meant for technical readers. */
export default function TechnicalDetails({ title, children }) {
  const t = useT();
  return (
    <details className="tech-details">
      <summary>
        <span className="inline-icon"><Microscope size={16} aria-hidden="true" />{title || t("tech.title")}</span>
        <span className="tech-hint">{t("tech.hint")}</span>
      </summary>
      <div className="tech-body">{children}</div>
    </details>
  );
}
