import { cloneElement, isValidElement } from "react";
import { CircleAlert } from "lucide-react";

/**
 * Label + control + hint/error. Optional: `required` (shows *), `unit` (shown beside the label)
 * and `help` (a short always-visible explanation above the control). The control is linked to
 * its help, hint and error text for screen readers; its own props and value are untouched.
 */
export default function FormField({ id, label, hint, error, children, required = false, unit, help }) {
  const describedBy = [help && `${id}-help`, error ? `${id}-error` : hint && `${id}-hint`].filter(Boolean).join(" ");
  const control = isValidElement(children) && describedBy
    ? cloneElement(children, {
      "aria-describedby": [children.props["aria-describedby"], describedBy].filter(Boolean).join(" "),
      "aria-invalid": error ? true : children.props["aria-invalid"],
    })
    : children;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {unit && <span className="field-unit"> ({unit})</span>}
        {required && <span className="field-req" aria-hidden="true"> *</span>}
      </label>
      {help && <span className="field-help" id={`${id}-help`}>{help}</span>}
      {control}
      {error ? <span className="error" id={`${id}-error`}><CircleAlert size={14} aria-hidden="true" />{error}</span>
        : hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}
