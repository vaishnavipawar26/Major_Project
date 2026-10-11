import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Loader from "./Loader";

export default function ProtectedRoute() {
  const { user, initializing } = useAuth();
  const location = useLocation();
  if (initializing) return <Loader label="Loading your account…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { user, initializing } = useAuth();
  if (initializing) return <Loader label="Loading…" />;
  return user ? <Navigate to="/dashboard" replace /> : <Outlet />;
}
