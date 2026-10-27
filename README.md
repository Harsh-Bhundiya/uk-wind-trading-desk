# UK Day-Ahead Renewable Energy Trading & Forecast Accuracy Platform

An end-to-end quantitative trading application designed for UK electricity utilities operating in the Day-Ahead wholesale market. It evaluates National Grid wind generation forecasts against actual delivered power from Elexon BMRS for January 2026, strictly eliminating lookahead bias and providing actionable procurement hedging.

---

## 1. Project Directory Structure

```
gridbricks-challenge/
├── .gitignore                     # Ignores bytecode, virtual environments, node_modules, and dist
├── Dockerfile                     # Production container spec for Python FastAPI (supports $PORT)
├── docker-compose.yml             # Full-stack container orchestration
├── requirements.txt               # Pinned Python dependencies
├── energy_data.db                 # SQLite database storing raw Elexon tables & 1,488 verified matched records
├── january_2026_wind_data.csv     # Exportable CSV of matched time series (1,488 rows)
├── ingest_elexon.py               # Matching ETL script with D-1 09:20 UTC gate-closure logic
├── main.py                        # FastAPI REST API with CORS, context-managed DB & P90 buffers
├── test_backend.py                # Automated pytest suite (includes zero hindsight leakage test)
└── frontend/                      # React SPA (Vite + Vanilla CSS + Chart.js)
    ├── Dockerfile                 # Multi-stage Nginx container with build-time ARG VITE_API_BASE
    ├── nginx.conf                 # Nginx SPA fallback configuration
    ├── vercel.json                # Vercel deployment routing configuration
    ├── package.json
    ├── src/
    │   ├── App.jsx                # Trading dashboard with dynamic cutoff metadata & adaptive buffer
    │   ├── index.css              # Custom Vanilla CSS utilizing trading color palette
    │   └── main.jsx
```

---

## 2. Key Architecture & Market Assumptions

### A. Strict Gate Closure (Elimination of Hindsight Leakage)
In Great Britain (GB), the Day-Ahead wholesale power auction (EPEX SPOT / Nord Pool) closes at **09:20:00 UTC** on day $D-1$ for electricity delivery across all 48 settlement periods of day $D$.
* **Flaw in Naive Matching:** Merely picking `MAX(publish_time)` pulls forecasts published *during or after* the delivery hour, introducing severe hindsight leakage.
* **Our Implementation:** The ETL pipeline enforces a strict cutoff: for delivery on date $D$, only forecasts published on or before $D-1$ at 09:20:00Z are eligible. Because Elexon issues forecasts at 07:30 UTC, 09:30 UTC, etc., the last pre-auction forecast available to the trader is the **07:30 UTC run**.
* **Result:** All 1,488 half-hourly settlement periods feature strictly positive lead times ranging between **16.5 hours and 40.0 hours** prior to delivery.

### B. High-Resolution Half-Hourly Alignment
While forecasts are published on an hourly grid, actual generation operates on 30-minute settlement periods (48 periods/day). Our matching engine maps each hourly forecast to both constituent settlement periods (e.g. 14:00 forecast applies to Periods 29 [14:00-14:30] and 30 [14:30-15:00]), ensuring all 1,488 actual records are evaluated with zero data omission.

### C. Quantified Accuracy & Asymmetric Error Hedging
Across all 1,488 periods in January 2026 under D-1 09:20Z cutoff:
* **True Day-Ahead MAE:** $\pm 2,145.17\text{ MW}$
* **Root Mean Squared Error (RMSE):** $2,615.81\text{ MW}$
* **Mean Absolute Percentage Error (MAPE):** $22.44\%$
* **Mean Bias Error (MBE):** $+1,851.90\text{ MW}$ (Consistent over-forecast in $84.9\%$ of periods).
* **Empirical P90 Buffer:** The 90th percentile deficit buffer is **$+4,291.00\text{ MW}$**, reflecting the high-tail risk of wind under-delivery.
* **Domain Hypothesis on Systematic Bias:** Elexon `WINDFOR` forecasts national transmission + embedded wind capacity, whereas `FUELHH` captures transmission-metered outturn. This structural offset causes the persistent $+1.85\text{ GW}$ over-prediction, reinforcing why utilities cannot trade purely on raw forecasts without hedging buffers.
* **Adaptive Hedging:** The procurement calculator provides both an **empirical P90 buffer cap** ($+4,291\text{ MW}$) and an **adaptive proportional buffer** ($22.44\%$ of forecasted volume), preventing artificial negative renewable credits during low-wind regimes.

### D. Data Ingestion Note (`ingest_elexon.py`)
The repository includes a pre-ingested SQLite database (`energy_data.db`) containing raw `actuals` and raw `forecasts` downloaded directly from the official Elexon BMRS API streams (`FUELHH/stream` and `WINDFOR/stream`). 

When `ingest_elexon.py` is executed locally, it processes and recomputes the strict D-1 09:20 UTC gate-closure matching from the local SQLite tables rather than re-downloading the entire multi-megabyte streams over the network. This eliminates network flakiness, rate-limiting, and makes local evaluation and CI test execution instantaneous.

---

## 3. How to Start the Application Locally

### Option 1: Direct Local Execution

#### Backend (Python 3.10+):
```bash
# In the root folder:
pip install -r requirements.txt
python main.py
# Backend runs at http://localhost:8000
# Interactive Swagger Documentation: http://localhost:8000/docs
```

#### Running Automated Tests:
```bash
python test_backend.py
# All 6 integration tests verify data integrity, zero hindsight leakage, and lead times.
```

#### Frontend (Node.js 18+):
```bash
cd frontend
npm install
npm run dev
# Frontend runs at http://localhost:5173
```

### Option 2: Docker Compose (Single Command)
```bash
docker-compose up --build
# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

---

## 4. Live Deployment

* **Frontend (Vercel):** Set Root Directory to `frontend`. Configure Environment Variable `VITE_API_BASE` pointing to backend URL.
* **Backend API (Render/Railway):** Connect GitHub repo, build command `pip install -r requirements.txt`, start command `uvicorn main:app --host 0.0.0.0 --port $PORT`.

---

## 5. Explicit Disclosure of AI Tool Usage

As permitted and encouraged by the hiring challenge instructions, AI assistance (Google Antigravity & Gemini & claude) was utilized during the development of this application for:
1. Brainstorming Day-Ahead gate closure market mechanics and mathematical formula definitions.
2. Rapid scaffolding of the FastAPI REST endpoints and Pydantic schemas.
3. Chart.js visual configuration and color palette harmonisation (`#010736`, `#0D1C42`, `#22396F`, `#FCF1D0`).
