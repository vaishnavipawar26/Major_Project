import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useKnownMessage } from "../i18n/LanguageContext";

const ICONS = { error: CircleAlert, info: Info, warn: TriangleAlert, success: CircleCheck };

export default function Alert({ type = "info", title, children, action }) {
  const known = useKnownMessage();
  const Icon = ICONS[type] || Info;
  // plain-string messages (e.g. API errors) are shown translated when the dictionary knows them exactly
  const body = typeof children === "string" ? known(children) : children;
  return (
    <div className={`alert alert-${type}`} role={type === "error" ? "alert" : "status"}>
      <Icon size={18} className="alert-icon" aria-hidden="true" />
      <div style={{ flex: 1 }}>
        {title && <strong>{title}</strong>}
        {body && <div>{body}</div>}
      </div>
      {action}
    </div>
  );
}
