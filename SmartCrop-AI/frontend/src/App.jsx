import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute, { PublicOnlyRoute } from "./components/ProtectedRoute";
import AppLayout from "./layouts/AppLayout";
import AuthLayout from "./layouts/AuthLayout";
import CropRecommendation from "./pages/CropRecommendation";
import CropExplanation from "./pages/CropExplanation";
import CropResult from "./pages/CropResult";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import PricePrediction from "./pages/PricePrediction";
import PriceExplanation from "./pages/PriceExplanation";
import PriceResult from "./pages/PriceResult";
import Profile from "./pages/Profile";
import Register from "./pages/Register";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/price-prediction" element={<PricePrediction />} />
          <Route path="/price-prediction/result" element={<PriceResult />} />
          <Route path="/price-prediction/explanation" element={<PriceExplanation />} />
          <Route path="/crop-recommendation" element={<CropRecommendation />} />
          <Route path="/crop-recommendation/result" element={<CropResult />} />
          <Route path="/crop-recommendation/explanation" element={<CropExplanation />} />
          <Route path="/history" element={<History />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
