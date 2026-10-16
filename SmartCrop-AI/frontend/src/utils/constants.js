import { CalendarCheck, CircleCheck, CircleHelp, Scale, Warehouse } from "lucide-react";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// Same convention as backend app/ml/common/seasons.py
export const MONTH_TO_SEASON = { 6: "Kharif", 7: "Kharif", 8: "Kharif", 9: "Kharif",
  10: "Rabi", 11: "Rabi", 12: "Rabi", 1: "Rabi", 2: "Zaid", 3: "Zaid", 4: "Zaid", 5: "Zaid" };
export const SEASONS = ["Kharif", "Rabi", "Zaid"];
export const STATE_MARKET = "All markets (state median)";

// Best-time-to-sell advice codes from the backend (app/ml/price_prediction/selling_advice.py)
export const ADVICE_STYLE = {
  WAIT: { tone: "good", icon: CalendarCheck },
  SELL_ON_TARGET: { tone: "good", icon: CircleCheck },
  NO_CLEAR_DIFFERENCE: { tone: "neutral", icon: Scale },
  STORAGE_LIMIT: { tone: "neutral", icon: Warehouse },
  UNAVAILABLE: { tone: "neutral", icon: CircleHelp },
};
