/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  // The app keeps its own base styles in index.css; Tailwind adds utilities only.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "var(--brand)", strong: "var(--brand-strong)", soft: "var(--brand-soft)" },
        surface: "var(--surface)",
        line: "var(--border)",
        ink: { DEFAULT: "var(--text)", 2: "var(--text-2)", muted: "var(--muted)" },
        actual: "var(--series-actual)",
        forecast: "var(--series-forecast)",
        pos: "var(--pos)",
        neg: "var(--neg)",
      },
      borderRadius: { card: "var(--radius)" },
    },
  },
  plugins: [],
};
