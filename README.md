# UK Day-Ahead Wind Forecast Accuracy & Procurement Desk

A web app for a UK energy utility's day-ahead trading team. It shows the wind forecast that was actually available before the day-ahead auction closed, measures how wrong that forecast was against Elexon actuals for January 2026, and turns the measured error into a thermal procurement estimate. The UI is responsive and works on phones, tablets and desktops.

Data scope: Elexon BMRS only, national wind generation. Actuals come from `FUELHH` (fuel type `WIND`) and forecasts from `WINDFOR`.

---

## 1. Repository layout

```
.
├── main.py                    FastAPI backend (read-only SQLite access, metrics, CSV export)
├── ingest_elexon.py           Rebuilds matched_time_series from the raw tables with the D-1 09:20 UTC cutoff
├── test_backend.py            Pytest suite, includes a no-hindsight-leakage test
├── energy_data.db             SQLite: raw actuals, raw forecasts, matched_time_series
├── january_2026_wind_data.csv Export of matched_time_series (1,488 rows)
├── requirements.txt           Runtime Python dependencies (pinned)
├── requirements-dev.txt       Runtime + test dependencies
├── Dockerfile                 Backend image (honours $PORT)
├── docker-compose.yml         Backend + frontend together
├── vercel.json                Vercel config for the backend project
├── .vercelignore / .dockerignore
└── frontend/                  React (Vite) + Chart.js single-page app
    ├── src/App.jsx            Dashboard, chart, procurement calculator
    ├── src/index.css          Mobile-first responsive styles
    ├── Dockerfile             Multi-stage build served by nginx (build arg VITE_API_BASE)
    ├── nginx.conf             SPA fallback
    └── vercel.json            SPA rewrite for the frontend project
```

---

## 2. Method and assumptions

**Decision cutoff.** The GB day-ahead auction on EPEX SPOT closes at 09:20 GMT on D-1. For delivery on day D, only forecasts with `publish_time <= (D-1) 09:20 UTC` are eligible, and the latest eligible one is used. Forecasts are issued at 02:30, 04:30, 07:30, 09:30 and so on (UTC), so the forecast available to the trader is the 07:30 run. Assumption: the client trades in that auction. In January, UTC equals UK local time.

**Why this matters.** Taking the latest forecast per slot (`MAX(publish_time)`) uses forecasts issued after delivery and understates the error. The cutoff version is stricter and gives a higher error.

**Half-hourly alignment.** Forecasts are hourly and actuals are half-hourly. Each hourly forecast is applied to both of its half-hour settlement periods, so all 1,488 actual periods (31 days x 48) are evaluated.

**Results (January 2026, all 1,488 periods):**

| Metric | Value |
|---|---|
| MAE | 2,145.17 MW |
| RMSE | 2,615.81 MW |
| MAPE | 22.44% |
| Mean bias (forecast - actual) | +1,851.90 MW |
| Periods over-forecast | 84.9% |
| P90 shortfall buffer | 4,291.00 MW |
| Lead time before cutoff | 16.5 h to 40.0 h |

**Systematic over-forecast.** The forecast is too high in most periods. One possible explanation is a difference in coverage between `WINDFOR` and `FUELHH`; this has not been verified, so the app treats it as a bias to hedge against.

**Procurement calculator.** Thermal to procure = demand - max(0, average forecast wind - buffer). The buffer is either the P90 cap or a proportional MAPE buffer. It uses the day's average forecast and one flat demand figure entered by the user. Real procurement is per slot, so treat it as an estimate.

**Data ingestion.** `energy_data.db` ships with the raw `actuals` and `forecasts` already downloaded from the Elexon `FUELHH` and `WINDFOR` streams. `ingest_elexon.py` does not call the network; it recomputes the matched table and CSV from those raw tables and gives identical output on re-run.

---

## 3. Run locally

### Backend (Python 3.10+)
```bash
pip install -r requirements-dev.txt
python main.py
```
API on http://localhost:8000, docs on http://localhost:8000/docs.

### Tests
```bash
python -m pytest -q test_backend.py
```

### Frontend (Node 18+)
```bash
cd frontend
npm install
npm run dev
```
App on http://localhost:5173. In development it calls http://localhost:8000. Set `VITE_API_BASE` to point elsewhere.

### Docker
```bash
docker compose up --build
```
Backend on http://localhost:8000, frontend on http://localhost:3000.

---

## 4. Deployment (Vercel)

Two Vercel projects from the same repo.

1. **Backend project**: Root Directory = repository root. `vercel.json` builds `main.py` with the Python runtime and bundles the database and CSV. Optionally set env var `ALLOWED_ORIGINS` to the frontend URL.
2. **Frontend project**: Root Directory = `frontend`. Framework preset Vite. Set env var `VITE_API_BASE` to the backend URL (no trailing slash), then redeploy, because Vite embeds it at build time.

Any Docker host can run the backend instead using the root `Dockerfile`.

**Live links**

* Frontend: LIVE_FRONTEND_URL
* Backend API: LIVE_BACKEND_URL

---

## 5. API

| Endpoint | Purpose |
|---|---|
| `GET /` | Service info and active cutoff |
| `GET /api/dates` | Available delivery dates |
| `GET /api/summary-metrics?start_date=&end_date=` | MAE, RMSE, MAPE, bias, P90 buffer, lead time |
| `GET /api/day-forecast?date=YYYY-MM-DD` | 48 slots with forecast, actual, publish time, lead time, band |
| `GET /api/export-csv` | Matched dataset as CSV |

---

## 6. AI tool disclosure

AI tools (Google Antigravity, Gemini and Claude) were used during development for: working through day-ahead market mechanics and the error metrics, scaffolding the FastAPI endpoints, reviewing the code and data for bugs, building the responsive React UI and Chart.js configuration, and writing the Docker and Vercel configuration. All results were re-checked against the raw database tables.
