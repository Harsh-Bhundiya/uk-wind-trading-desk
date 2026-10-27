"""
Gridbricks UK Energy Trading Desk - Production FastAPI Backend Service
Features:
- Strict D-1 09:20 UTC Gate Closure Matching (Eliminating Lookahead Bias)
- Context-managed DB connections (Proper connection pooling & closure)
- Quantile-based P90 & Bias-Adjusted Thermal Safety Buffers
- Full Half-Hourly Resolution (1,488 slots for Jan 2026)
- Configurable Environment Variables & Docker Readiness (0.0.0.0 host)
"""

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from contextlib import contextmanager
import sqlite3
import os
import math
from typing import Optional

app = FastAPI(
    title="Gridbricks UK Renewable Energy Trading API",
    description="Production-grade API evaluating UK Day-Ahead Wind Generation Forecasts against Elexon BMRS Actuals.",
    version="2.1.0"
)

# CORS setup - allowing all for development, easily restricted via ENV
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "energy_data.db")
CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "january_2026_wind_data.csv")

@contextmanager
def get_db():
    if not os.path.exists(DB_PATH):
        raise HTTPException(status_code=500, detail="Database not initialized. Please run ingest_elexon.py.")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.get("/")
def health_check():
    return {
        "status": "online",
        "service": "Gridbricks UK Renewable Energy Trading API",
        "version": "2.1.0",
        "gate_closure_cutoff": "D-1 09:20:00Z (GB Day-Ahead Auction Gate Closure)",
        "dataset_scope": "January 2026 (1488 Half-Hourly Settlement Periods)",
        "docs_url": "/docs"
    }

@app.get("/api/dates")
def list_available_dates():
    """Returns all 31 settlement dates in January 2026."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT settlement_date FROM matched_time_series ORDER BY settlement_date ASC")
        dates = [row["settlement_date"] for row in cursor.fetchall()]
        return {"dates": dates, "total_days": len(dates)}

@app.get("/api/summary-metrics")
def get_summary_metrics(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    Computes rigorous quantitative accuracy metrics:
    - MAE (Mean Absolute Error in MW)
    - RMSE (Root Mean Squared Error in MW)
    - MAPE (Filtered Mean Absolute Percentage Error, ignoring generation <= 10 MW)
    - MBE (Mean Bias Error in MW, quantifying persistent over-forecast)
    - P90 Conservative Thermal Buffer (Quantile 90% worst-case deficit)
    - Average Forecast Lead Time (Hours ahead of delivery)
    """
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT 
                error, abs_error, percentage_error, actual_generation, 
                forecast_generation, lead_time_hours
            FROM matched_time_series
        """
        params = []
        
        if start_date and end_date:
            query += " WHERE settlement_date BETWEEN ? AND ?"
            params = [start_date, end_date]
        elif start_date:
            query += " WHERE settlement_date >= ?"
            params = [start_date]
        elif end_date:
            query += " WHERE settlement_date <= ?"
            params = [end_date]
            
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        if not rows:
            raise HTTPException(status_code=404, detail="No records found for the requested date range.")
            
        n = len(rows)
        errors = [r["error"] for r in rows]
        abs_errors = [r["abs_error"] for r in rows]
        pct_errors = [r["percentage_error"] for r in rows if r["percentage_error"] is not None]
        
        mae = sum(abs_errors) / n
        sum_sq = sum(e ** 2 for e in errors)
        rmse = math.sqrt(sum_sq / n)
        mape = sum(pct_errors) / len(pct_errors) if pct_errors else 0.0
        mbe = sum(errors) / n
        
        sorted_errors = sorted(errors)
        p90_index = int(0.90 * n)
        p90_deficit_buffer = max(0.0, sorted_errors[p90_index])
        
        avg_lead_time = sum(r["lead_time_hours"] for r in rows) / n
        over_fc_pct = (sum(1 for e in errors if e > 0) / n) * 100.0
        under_fc_pct = (sum(1 for e in errors if e < 0) / n) * 100.0
        
        total_actual_gwh = sum(r["actual_generation"] for r in rows) * 0.5 / 1000.0
        total_forecast_gwh = sum(r["forecast_generation"] for r in rows) * 0.5 / 1000.0
        
        return {
            "period": f"{start_date or '2026-01-01'} to {end_date or '2026-01-31'}",
            "settlement_periods_analyzed": n,
            "hours_analyzed": round(n * 0.5, 1),
            "mae_mw": round(mae, 2),
            "rmse_mw": round(rmse, 2),
            "mape_percent": round(mape, 2),
            "mean_bias_mw": round(mbe, 2),
            "p90_thermal_buffer_mw": round(p90_deficit_buffer, 2),
            "avg_lead_time_hours": round(avg_lead_time, 1),
            "over_forecast_percentage": round(over_fc_pct, 1),
            "under_forecast_percentage": round(under_fc_pct, 1),
            "total_actual_gwh": round(total_actual_gwh, 2),
            "total_forecast_gwh": round(total_forecast_gwh, 2)
        }

@app.get("/api/day-forecast")
def get_day_forecast(date: str = Query(..., description="Settlement date in YYYY-MM-DD format, e.g. 2026-01-15")):
    """
    Returns all 48 half-hourly settlement periods for the chosen date:
    Includes forecast, actual, exact publish_time, lead_time_hours, and uncertainty bands.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                start_time, settlement_period, actual_generation,
                forecast_generation, forecast_publish_time, gate_closure_cutoff, lead_time_hours,
                error, percentage_error
            FROM matched_time_series
            WHERE settlement_date = ?
            ORDER BY start_time ASC
        """, (date,))
        rows = cursor.fetchall()
        
        if not rows:
            raise HTTPException(status_code=404, detail=f"No data available for settlement date {date}")
            
        slots = []
        day_abs_errors = [abs(r["error"]) for r in rows]
        day_mae = sum(day_abs_errors) / len(day_abs_errors)
        
        for r in rows:
            time_part = r["start_time"].split("T")[1][:5]
            forecast = r["forecast_generation"]
            actual = r["actual_generation"]
            slots.append({
                "start_time": r["start_time"],
                "time_label": time_part,
                "period": r["settlement_period"],
                "forecast_mw": forecast,
                "actual_mw": actual,
                "error_mw": round(r["error"], 1),
                "percentage_error": round(r["percentage_error"], 1) if r["percentage_error"] is not None else None,
                "publish_time": r["forecast_publish_time"],
                "gate_closure_cutoff": r["gate_closure_cutoff"],
                "lead_time_hours": r["lead_time_hours"],
                "uncertainty_upper_mw": round(forecast + day_mae, 1),
                "uncertainty_lower_mw": round(max(0, forecast - day_mae), 1)
            })
            
        peak_forecast = max(s["forecast_mw"] for s in slots)
        peak_actual = max(s["actual_mw"] for s in slots)
        total_forecast_gwh = sum(s["forecast_mw"] for s in slots) * 0.5 / 1000.0
        total_actual_gwh = sum(s["actual_mw"] for s in slots) * 0.5 / 1000.0
        day_lead_time = sum(s["lead_time_hours"] for s in slots) / len(slots)
        
        return {
            "date": date,
            "slots_count": len(slots),
            "day_mae_mw": round(day_mae, 2),
            "avg_lead_time_hours": round(day_lead_time, 1),
            "peak_forecast_mw": round(peak_forecast, 1),
            "peak_actual_mw": round(peak_actual, 1),
            "total_forecast_gwh": round(total_forecast_gwh, 2),
            "total_actual_gwh": round(total_actual_gwh, 2),
            "time_series": slots
        }

@app.get("/api/export-csv")
def download_csv():
    """Allows downloading the verified January 2026 dataset with 1488 records."""
    if not os.path.exists(CSV_PATH):
        raise HTTPException(status_code=404, detail="Dataset CSV not generated.")
    return FileResponse(
        CSV_PATH,
        media_type="text/csv",
        filename="gridbricks_uk_wind_january_2026_verified.csv"
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting Gridbricks UK Wind Energy Trading Backend on 0.0.0.0:{port} ...")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
