"""
Unit & Integration Test Suite for Gridbricks Backend API.
Verifies endpoints, data integrity, gate-closure logic, and error math.
"""

from fastapi.testclient import TestClient
from main import app
import sqlite3
import os

client = TestClient(app)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "energy_data.db")

def test_health_check():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "09:20" in data["gate_closure_cutoff"]

def test_available_dates():
    response = client.get("/api/dates")
    assert response.status_code == 200
    data = response.json()
    assert data["total_days"] == 31
    assert "2026-01-01" in data["dates"]
    assert "2026-01-31" in data["dates"]

def test_summary_metrics():
    response = client.get("/api/summary-metrics")
    assert response.status_code == 200
    data = response.json()
    assert data["settlement_periods_analyzed"] == 1488
    assert data["hours_analyzed"] == 744.0
    # True Day-Ahead MAE for D-1 09:20Z should be ~2145 MW
    assert 2050 < data["mae_mw"] < 2250
    # Over-forecast bias should be positive and ~1850 MW
    assert 1700 < data["mean_bias_mw"] < 2000
    # Lead time must be strictly positive and > 16 hrs
    assert data["avg_lead_time_hours"] > 16.0

def test_no_forecast_after_gate_closure():
    """
    CRITICAL AUDIT TEST:
    Verifies that ZERO forecasts in matched_time_series were published after D-1 09:20:00Z.
    Eliminates hindsight leakage / lookahead bias.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(*)
        FROM matched_time_series
        WHERE forecast_publish_time > gate_closure_cutoff
    """)
    leakage_count = cursor.fetchone()[0]
    conn.close()
    assert leakage_count == 0, f"Found {leakage_count} forecasts published AFTER gate closure cutoff!"

def test_day_forecast_all_48_slots():
    response = client.get("/api/day-forecast?date=2026-01-15")
    assert response.status_code == 200
    data = response.json()
    assert data["slots_count"] == 48
    assert len(data["time_series"]) == 48
    
    first_slot = data["time_series"][0]
    assert "publish_time" in first_slot
    assert "lead_time_hours" in first_slot
    assert first_slot["lead_time_hours"] >= 16.5

def test_invalid_date_404():
    response = client.get("/api/day-forecast?date=2026-02-15")
    assert response.status_code == 404

if __name__ == "__main__":
    test_health_check()
    print("[PASS] Health check & dynamic cutoff")
    test_available_dates()
    print("[PASS] Available dates (31 days)")
    test_summary_metrics()
    print("[PASS] Summary metrics (1488 slots, MAE ~2145 MW)")
    test_no_forecast_after_gate_closure()
    print("[PASS] Zero hindsight leakage test (ZERO records after D-1 09:20Z)")
    test_day_forecast_all_48_slots()
    print("[PASS] Day forecast (48 half-hourly periods with lead times >= 16.5h)")
    test_invalid_date_404()
    print("[PASS] 404 validation")
    print("\n=== ALL 6 RIGOROUS TESTS PASSED 100% ===")
