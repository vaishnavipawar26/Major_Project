import { Link } from "react-router-dom";
import { Sprout } from "lucide-react";

export default function Footer() {
  return (
    <footer className="app-footer">
      <div className="content footer-inner">
        <div className="footer-brand">
          <span className="footer-mark" aria-hidden="true"><Sprout size={16} /></span>
          <div>
            <strong>SmartCrop AI</strong>
            <p>AI-powered insights for smarter agricultural decisions.</p>
          </div>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <Link to="/price-prediction">Price Prediction</Link>
          <Link to="/crop-recommendation">Crop Recommendation</Link>
          <Link to="/history">History</Link>
        </nav>
      </div>
      <div className="content footer-meta">
        <span>&copy; {new Date().getFullYear()} SmartCrop AI. Built for smarter farming.</span>
        <span>Forecasts are model-based estimates, not guarantees.</span>
      </div>
    </footer>
  );
}
