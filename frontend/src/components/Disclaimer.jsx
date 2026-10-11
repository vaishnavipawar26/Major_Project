import Alert from "./Alert";

export default function Disclaimer({ children }) {
  return (
    <Alert type="info">
      {children || "This is a model-based estimate and actual market prices may differ. It is not a guarantee."}
    </Alert>
  );
}
