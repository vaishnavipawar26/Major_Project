import { Outlet } from "react-router-dom";
import { BrainCircuit, ChartNoAxesCombined, Sprout } from "lucide-react";

const POINTS = [
  { icon: ChartNoAxesCombined, text: "Price forecasts for 7 crops in Maharashtra mandis" },
  { icon: Sprout, text: "Crop suggestions from your soil, weather and selling month" },
  { icon: BrainCircuit, text: "Every result explained in simple words" },
];

export default function AuthLayout() {
  return (
    <div className="auth-page">
      <section className="auth-side">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true"><Sprout size={20} /></span>
          <span className="brand-text">SmartCrop <span>AI</span></span>
        </div>
        <p className="auth-lead">
          Market price forecasts and crop suggestions — with clear reasons you can check.
        </p>
        <ul className="auth-points">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text}><span aria-hidden="true"><Icon size={18} /></span>{text}</li>
          ))}
        </ul>
        <p className="small auth-note">Forecasts are model-based estimates, not guarantees.</p>
      </section>
      <section className="auth-form">
        <Outlet />
      </section>
    </div>
  );
}
