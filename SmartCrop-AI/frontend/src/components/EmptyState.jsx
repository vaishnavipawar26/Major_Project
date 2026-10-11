import { Sprout } from "lucide-react";

/** `icon` is a lucide-react icon component. */
export default function EmptyState({ icon: Icon = Sprout, title, children, action }) {
  return (
    <div className="empty">
      <div className="icon" aria-hidden="true"><Icon size={24} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
