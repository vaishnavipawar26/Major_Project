import { Component } from "react";
import { TriangleAlert } from "lucide-react";
import { useT } from "../i18n/LanguageContext";

/** Catches a render error inside one widget, so the rest of the page keeps working. */
class Boundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) {
    // keep the cause visible to developers; the farmer only sees the small message
    console.error(`Widget "${this.props.name}" failed to render:`, error, info?.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card widget-error" role="alert" data-testid={`widget-error-${this.props.name}`}>
        <TriangleAlert size={18} aria-hidden="true" /> <span>{this.props.message}</span>
      </div>
    );
  }
}

/** A dashboard section that fails on its own: "This section couldn't load" instead of a blank page. */
export default function WidgetBoundary({ name, children }) {
  const t = useT();
  return <Boundary name={name} message={t("widget.error")}>{children}</Boundary>;
}
