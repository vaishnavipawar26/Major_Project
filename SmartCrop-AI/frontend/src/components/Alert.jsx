import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

const ICONS = { error: CircleAlert, info: Info, warn: TriangleAlert, success: CircleCheck };

export default function Alert({ type = "info", title, children, action }) {
  const Icon = ICONS[type] || Info;
  return (
    <div className={`alert alert-${type}`} role={type === "error" ? "alert" : "status"}>
      <Icon size={18} className="alert-icon" aria-hidden="true" />
      <div style={{ flex: 1 }}>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}
