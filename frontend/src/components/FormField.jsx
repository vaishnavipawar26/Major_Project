export default function FormField({ id, label, hint, error, children }) {
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="error" id={`${id}-error`}>{error}</span>
        : hint && <span className="hint">{hint}</span>}
    </div>
  );
}
