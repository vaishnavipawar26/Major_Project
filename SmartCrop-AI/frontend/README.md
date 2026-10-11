# SmartCrop AI — Frontend (React + Vite)

```bash
npm install
copy .env.example .env     # set VITE_API_URL (default http://localhost:8000)
npm run dev                # http://localhost:5173
npm run build              # production build in dist/
```

Structure: `src/pages` (screens), `src/components` (reusable UI, `charts/` with Recharts),
`src/layouts` (sidebar and auth layouts), `src/services` (Axios API calls with JWT
interceptor), `src/context/AuthContext.jsx` (session), `src/hooks`, `src/utils`.

Routes: `/login`, `/register`, `/dashboard`, `/price-prediction`, `/price-prediction/result`,
`/crop-recommendation`, `/crop-recommendation/result`, `/history`, `/profile`. All except
login/register are protected.

Chart colours follow a colour-blind-checked palette: actual prices blue (solid), forecasts
orange (dashed) with a shaded range; SHAP bars use blue (up/supports) vs red (down/against)
and always carry signed value labels.
