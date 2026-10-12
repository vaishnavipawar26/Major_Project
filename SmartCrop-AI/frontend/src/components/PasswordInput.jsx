import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "../i18n/LanguageContext";

/**
 * Password box with a show/hide button. Every prop (id, value, onChange, autoComplete, aria-*)
 * goes to the <input> unchanged; only its `type` switches between password and text.
 */
export default function PasswordInput(props) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="password-input">
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className="password-toggle" onClick={() => setShow((s) => !s)}
        aria-pressed={show} aria-controls={props.id} aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")}>
        {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
