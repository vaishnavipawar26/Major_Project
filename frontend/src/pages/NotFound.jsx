import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import EmptyState from "../components/EmptyState";

export default function NotFound() {
  return (
    <EmptyState icon={Compass} title="Page not found"
      action={<Link className="btn btn-primary" to="/dashboard">Go to dashboard</Link>}>
      The page you are looking for does not exist.
    </EmptyState>
  );
}
