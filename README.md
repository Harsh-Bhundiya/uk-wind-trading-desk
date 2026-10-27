# UK Day-Ahead Wind Forecast Accuracy & Procurement Desk

A web app for a UK energy utility's day-ahead trading team. It displays the latest renewable wind generation forecast available prior to the day-ahead wholesale auction gate closure, quantitatively measures forecast error against actual delivered generation from Elexon for January 2026, and translates historical error into actionable thermal procurement safety buffers. The UI is responsive across desktop, tablet, and mobile devices.

Data scope: Elexon BMRS only, UK national wind generation. Actuals from `FUELHH` (fuel type `WIND`) and forecasts from `WINDFOR`.

---

## 1. Live Deployment Links

* **Live Frontend Application (Vercel):** https://uk-wind-trading-desk.vercel.app
* **Live Backend API (Render):** https://uk-wind-trading-desk.onrender.com
* **Interactive API Documentation (Swagger UI):** https://uk-wind-trading-desk.onrender.com/docs

---

## 2. Repository Layout

```
.
├── main.py                    FastAPI backend (read-only SQLite access, metrics, CSV export)
├── ingest_elexon.py           Rebuilds matched_time_series from raw tables with D-1 09:20 UTC cutoff
├── test_backend.py            Pytest suite (endpoint contracts, row counts, no-hindsight-leakage assertion)
├── energy_data.db             SQLite database: raw actuals, raw forecasts, and matched_time_series
├── january_2026_wind_data.csv Export of matched_time_series (1,488 half-hourly rows)
├── requirements.txt           Runtime Python dependencies
├── requirements-dev.txt       Runtime + test dependencies (pytest, httpx)
├── Dockerfile                 Backend container image (honours dynamic $PORT)
├── docker-compose.yml         Full-stack local orchestration (backend + frontend)
├── .dockerignore              Docker build ignore rules
├── .gitignore                 Git ignore rules
└── frontend/                  React (Vite) single-page application
    ├── src/App.jsx            Trading dashboard, 48-period chart, procurement calculator
    ├── src/index.css          Responsive mobile-first Vanilla CSS styling
    ├── src/main.jsx           Application entry point
    ├── Dockerfile             Multi-stage frontend build served via Nginx
    ├── nginx.conf             Nginx reverse proxy and SPA routing fallback
    ├── package.json           Frontend dependencies (React, Chart.js, Lucide-react)
    ├── vite.config.js         Vite build configuration
    └── vercel.json            Vercel SPA rewrite configuration
```

---

## 3. Method and Assumptions

**Decision cutoff (No Lookahead Bias / Hindsight Leakage):**  
The GB day-ahead auction on EPEX SPOT closes at 09:20 GMT on D-1. For delivery on day D, only forecasts published at or before `(D-1) 09:20 UTC` are legally available to trading desks. Elexon issues `WINDFOR` runs at 02:30, 04:30, 07:30, 09:30, etc. (UTC). Our ingestion pipeline strictly selects the latest eligible forecast before gate closure — the **07:30 UTC morning run** — providing an authentic decision lead-time between **16.5 and 40.0 hours**.

*Why this matters:* Naively taking `MAX(publish_time)` without a cutoff selects forecasts generated during or after delivery, artificially understating error. Enforcing the strict gate-closure cutoff reflects true operational conditions.

**Half-hourly alignment:**  
Elexon forecasts are published hourly, while UK settlements run on 30-minute intervals (48 settlement periods per day). Each hourly forecast is applied to both corresponding half-hour periods, evaluating all **1,488 periods** of January 2026 (31 days × 48 periods).

**Quantitative Error Evaluation (January 2026, all 1,488 periods):**

| Metric | Value | Interpretation |
|---|---|---|
| **MAE** | 2,145.17 MW | Average absolute deviation per half-hour period |
| **RMSE** | 2,615.81 MW | Root Mean Squared Error, penalising extreme outliers |
| **MAPE** | 22.44% | Mean Absolute Percentage Error relative to actuals |
| **Mean Bias** | +1,851.90 MW | Systematic over-forecast (`forecast - actual`) |
| **Periods Over-Forecast** | 84.9% | Percentage of periods where forecast exceeded actual generation |
| **P90 Deficit Buffer** | 4,291.00 MW | 90th percentile shortfall protection margin |
| **Decision Lead Time** | 16.5 h – 40.0 h | True operational lead time prior to physical delivery |

**Systematic Over-forecast:**  
Wind generation was over-estimated in 84.9% of all trading periods. This likely reflects differences between transmission-metered wind (`FUELHH`) and embedded wind generation assumptions in `WINDFOR`. The platform accounts for this by providing safety buffers to hedge against deficit risks.

**Procurement Calculator:**  
`Thermal To Procure = Demand - max(0, Average Forecast Wind - Safety Buffer)`.  
The buffer can be toggled between an Adaptive Percentage Error (22.4% MAPE) and a conservative P90 Deficit Buffer (+4,291 MW).

**Data Ingestion:**  
`energy_data.db` contains raw actuals (`FUELHH`, wind) and raw forecasts (`WINDFOR`) downloaded directly from the Elexon BMRS API. Running `python ingest_elexon.py` deterministically recomputes `matched_time_series` and regenerates `january_2026_wind_data.csv`.

---

## 4. How to Run Locally

### Backend (Python 3.10+)
```bash
pip install -r requirements-dev.txt
python main.py
```
* API runs on: http://localhost:8000
* Interactive Swagger docs: http://localhost:8000/docs

### Backend Tests
```bash
python -m pytest -v test_backend.py
```
Executes all 6 tests including endpoint contracts, row-count validation (1,488 rows), and gate-closure cutoff integrity (`test_no_forecast_after_gate_closure`).

### Frontend (Node 18+)
```bash
cd frontend
npm install
npm run dev
```
* Frontend runs on: http://localhost:5173
* In development, it defaults to calling `http://localhost:8000`. Set `VITE_API_BASE` in `.env` to point elsewhere.

### Full-Stack Docker
```bash
docker compose up --build
```
* Backend runs on: http://localhost:8000
* Frontend runs on: http://localhost:3000

---

## 5. Deployment Architecture

The application is deployed across two decoupled production environments:

1. **Backend (Render):**
   * Hosted as a Web Service running Python / Docker.
   * Starts with `uvicorn main.py:app --host 0.0.0.0 --port $PORT`.
   * Serves read-only analytical queries against `energy_data.db` with CORS enabled for frontend domains.
   * Live URL: https://uk-wind-trading-desk.onrender.com

2. **Frontend (Vercel):**
   * Hosted as a Single Page Application (SPA) built from the `frontend/` directory with Vite.
   * Client-side routing rewrite handled via `frontend/vercel.json`.
   * Environment variable `VITE_API_BASE` set to `https://uk-wind-trading-desk.onrender.com` (with automatic trimming and safe production fallback embedded).
   * Live URL: https://uk-wind-trading-desk.vercel.app

---

## 6. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Service health check, active cutoff rules, and environment metadata |
| `GET` | `/api/dates` | List of all available delivery dates in January 2026 |
| `GET` | `/api/summary-metrics` | Aggregated KPIs (MAE, RMSE, MAPE, Bias, P90 buffer, period counts) |
| `GET` | `/api/day-forecast?date=YYYY-MM-DD` | 48 settlement periods with forecast, actuals, error, lead time, and uncertainty bands |
| `GET` | `/api/export-csv` | Stream-downloads the complete 1,488-row matched January 2026 dataset |

---

## 7. AI Tool Disclosure

In accordance with assignment guidelines, AI tools (Google Antigravity, Gemini and Claude) were utilized during development for:
* Analyzing Elexon BMRS API data structures and UK day-ahead auction cutoff mechanics.
* Scaffolding initial FastAPI endpoints and Pytest test fixtures.
* Generating responsive Vanilla CSS layout utilities and Chart.js configuration.
* Containerization and deployment configuration for Docker, Render, and Vercel.

All data calculations, gate-closure cutoff logic, and statistical error metrics were verified and tested directly against the underlying Elexon database records.
