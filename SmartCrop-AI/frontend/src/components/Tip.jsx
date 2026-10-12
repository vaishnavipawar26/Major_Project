import { useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { useT } from "../i18n/LanguageContext";

const key = (id) => `smartcrop_tip_${id}`;
const isHidden = (id) => { try { return localStorage.getItem(key(id)) === "1"; } catch { return false; } };

/**
 * Short, dismissible hint shown in one place per page. Closing it hides it in this browser for
 * good (remembered in localStorage; if storage is unavailable it simply shows again next time).
 */
export default function Tip({ id, children, className = "" }) {
  const t = useT();
  const [hidden, setHidden] = useState(() => isHidden(id));
  const [leaving, setLeaving] = useState(false);
  if (hidden) return null;
  const dismiss = () => {
    try { localStorage.setItem(key(id), "1"); } catch { /* storage unavailable */ }
    setLeaving(true);
    setTimeout(() => setHidden(true), 180);
  };
  return (
    <aside className={`tip${leaving ? " is-leaving" : ""} ${className}`} aria-label={t("tip.label")}>
      <Lightbulb size={18} aria-hidden="true" className="tip-icon" />
      <div className="tip-body">{children}</div>
      <button type="button" className="tip-close" onClick={dismiss} aria-label={t("tip.dismiss")}>
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
