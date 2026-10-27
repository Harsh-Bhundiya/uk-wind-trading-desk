import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { 
  Wind, 
  TrendingUp, 
  AlertTriangle, 
  ShieldCheck, 
  Download, 
  Calendar, 
  Zap, 
  Calculator,
  Clock,
  AlertCircle
} from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export default function App() {
  const [systemInfo, setSystemInfo] = useState(null);
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("2026-01-15");
  const [summary, setSummary] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  
  // Trading Decision Calculator State
  const [consumerDemand, setConsumerDemand] = useState(15000); // 15,000 MW target
  const [bufferMode, setBufferMode] = useState("p90"); // "p90" (empirical MW) or "pct" (proportional MAPE)

  // Initial load: fetch system info, available dates & summary accuracy metrics
  useEffect(() => {
    async function initDashboard() {
      try {
        setErrorMsg(null);
        const [infoRes, datesRes, summaryRes] = await Promise.all([
          fetch(`${API_BASE}/`),
          fetch(`${API_BASE}/api/dates`),
          fetch(`${API_BASE}/api/summary-metrics`)
        ]);

        if (!infoRes.ok || !datesRes.ok || !summaryRes.ok) {
          throw new Error("Unable to reach trading backend service.");
        }

        const infoJson = await infoRes.json();
        const datesJson = await datesRes.json();
        const summaryJson = await summaryRes.json();
        
        setSystemInfo(infoJson);
        setDates(datesJson.dates || []);
        setSummary(summaryJson);

        if (datesJson.dates && datesJson.dates.length > 0) {
          setSelectedDate(datesJson.dates.includes("2026-01-15") ? "2026-01-15" : datesJson.dates[0]);
        }
      } catch (err) {
        console.error("Dashboard init error:", err);
        setErrorMsg("Failed to connect to backend API. Please ensure the server is running.");
      }
    }
    initDashboard();
  }, []);

  // Fetch 48 half-hour settlement periods when selected date changes
  useEffect(() => {
    if (!selectedDate) return;
    async function fetchDayData() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`${API_BASE}/api/day-forecast?date=${selectedDate}`);
        if (!res.ok) {
          throw new Error(`Failed to load settlement data for ${selectedDate} (HTTP ${res.status})`);
        }
        const data = await res.json();
        setDayData(data);
      } catch (err) {
        console.error("Day fetch error:", err);
        setErrorMsg(err.message || "Error fetching settlement data.");
        setDayData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchDayData();
  }, [selectedDate]);

  // Chart time series setup (48 half-hour slots)
  const chartLabels = dayData?.time_series?.map(s => s.time_label) || [];
  const forecastSeries = dayData?.time_series?.map(s => s.forecast_mw) || [];
  const actualSeries = dayData?.time_series?.map(s => s.actual_mw) || [];
  const upperBand = dayData?.time_series?.map(s => s.uncertainty_upper_mw) || [];
  const lowerBand = dayData?.time_series?.map(s => s.uncertainty_lower_mw) || [];

  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Day-Ahead Forecast (D-1 As-Of)',
        data: forecastSeries,
        borderColor: '#FCF1D0',
        backgroundColor: '#FCF1D0',
        borderWidth: 2.5,
        tension: 0.25,
        pointRadius: 1.5,
        pointHoverRadius: 6,
      },
      {
        label: 'Actual Wind Delivered',
        data: actualSeries,
        borderColor: '#38BDF8',
        backgroundColor: '#38BDF8',
        borderWidth: 2.2,
        borderDash: [4, 4],
        tension: 0.25,
        pointRadius: 1.5,
        pointHoverRadius: 6,
      },
      {
        label: 'Uncertainty Upper (+MAE)',
        data: upperBand,
        borderColor: 'transparent',
        backgroundColor: 'rgba(252, 241, 208, 0.08)',
        fill: '+1',
        pointRadius: 0,
      },
      {
        label: 'Uncertainty Lower (-MAE)',
        data: lowerBand,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        fill: false,
        pointRadius: 0,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0D1C42',
        titleColor: '#FCF1D0',
        bodyColor: '#FFFFFF',
        borderColor: '#22396F',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: function(context) {
            if (context.dataset.label.includes('Uncertainty')) return null;
            return ` ${context.dataset.label}: ${context.raw ? context.raw.toLocaleString() : 0} MW`;
          },
          afterBody: function(items) {
            const index = items[0]?.dataIndex;
            const slot = dayData?.time_series?.[index];
            if (slot) {
              return [
                `Deviation: ${slot.error_mw > 0 ? '+' : ''}${slot.error_mw.toLocaleString()} MW`,
                `Published: ${slot.publish_time?.split('T')[1]?.slice(0, 5)}Z (Pre-Auction Lead: ${slot.lead_time_hours}h)`
              ];
            }
            return [];
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(34, 57, 111, 0.25)' },
        ticks: { 
          color: '#94A3B8', 
          font: { size: 10 },
          maxRotation: 0,
          callback: function(val, index) {
            return index % 4 === 0 ? this.getLabelForValue(val) : '';
          }
        }
      },
      y: {
        grid: { color: 'rgba(34, 57, 111, 0.25)' },
        ticks: { 
          color: '#94A3B8',
          callback: (val) => `${val.toLocaleString()} MW`
        }
      }
    }
  };

  // Adaptive Decision Calculation Logic (Handling low and high wind regimes)
  const avgForecast = dayData?.time_series?.length 
    ? (dayData.time_series.reduce((acc, curr) => acc + curr.forecast_mw, 0) / dayData.time_series.length)
    : 0;

  // Proportional Buffer (MAPE-based) scales with wind volume, preventing negative wind on low wind days
  const proportionalBuffer = avgForecast * ((summary?.mape_percent || 22.4) / 100.0);
  const fixedP90Buffer = summary?.p90_thermal_buffer_mw || 3200;

  const appliedBuffer = bufferMode === "pct" 
    ? proportionalBuffer 
    : Math.min(avgForecast * 0.9, fixedP90Buffer);

  const conservativeWind = Math.max(0, avgForecast - appliedBuffer);
  const thermalToProcure = Math.max(0, consumerDemand - conservativeWind);

  return (
    <div className="dashboard-container">
      {/* HEADER WITH DYNAMIC SYSTEM METADATA */}
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">
            <Zap size={24} />
          </div>
          <div className="header-title">
            <h1>GRIDBRICKS • UK Wind Day-Ahead Trading Desk</h1>
            <p>
              Elexon BMRS January 2026 • Cutoff: {systemInfo?.gate_closure_cutoff || "D-1 09:20:00Z (GB Auction Deadline)"}
            </p>
          </div>
        </div>

        <div className="header-controls">
          <div className="date-picker-box">
            <Calendar size={16} color="#94A3B8" />
            <label>Delivery Day:</label>
            <select 
              value={selectedDate} 
              onChange={(e) => setSelectedDate(e.target.value)}
            >
              {dates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <a 
            href={`${API_BASE}/api/export-csv`} 
            className="btn-export" 
            download
            title="Download verified 1488 records as CSV"
          >
            <Download size={15} />
            Export CSV
          </a>
        </div>
      </header>

      {errorMsg && (
        <div style={{ background: '#7F1D1D', color: '#FEE2E2', padding: '12px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <AlertCircle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* METRIC CARDS */}
      <section className="metrics-grid">
        <div className="metric-card highlight">
          <div className="metric-header">
            <span>True Day-Ahead MAE</span>
            <AlertTriangle size={18} color="#FCF1D0" />
          </div>
          <div className="metric-value cream">
            ±{summary ? Math.round(summary.mae_mw).toLocaleString() : "..."} MW
          </div>
          <div className="metric-footer">
            <Clock size={13} color="#94A3B8" />
            <span>Avg {summary ? summary.avg_lead_time_hours : 27}h lead time ahead of delivery</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Over-Forecast Bias (MBE)</span>
            <TrendingUp size={18} color="#38BDF8" />
          </div>
          <div className="metric-value" style={{ color: '#F87171' }}>
            +{summary ? Math.round(summary.mean_bias_mw).toLocaleString() : "..."} MW
          </div>
          <div className="metric-footer">
            <span>Systemic wind over-prediction ({summary?.over_forecast_percentage}% of time)</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Percentage Error (MAPE)</span>
            <TrendingUp size={18} color="#34D399" />
          </div>
          <div className="metric-value">
            {summary ? `${summary.mape_percent}%` : "..."}
          </div>
          <div className="metric-footer">
            <span>Across all 1,488 settlement periods (D-1 09:20Z)</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>P90 Deficit Buffer</span>
            <ShieldCheck size={18} color="#FCF1D0" />
          </div>
          <div className="metric-value cream">
            +{summary ? Math.round(summary.p90_thermal_buffer_mw).toLocaleString() : "..."} MW
          </div>
          <div className="metric-footer">
            <span>90th percentile worst-case delivery shortfall</span>
          </div>
        </div>
      </section>

      {/* MAIN CONTENT: TIME-SERIES CHART & TRADING DESK CALCULATOR */}
      <section className="main-grid">
        {/* CHART PANEL */}
        <div className="card-panel">
          <div className="panel-title">
            <h2>
              <Wind size={18} />
              48-Period Day-Ahead Renewable Generation Profile
            </h2>
            <div className="chart-legend-box">
              <div className="legend-item">
                <div className="legend-dot forecast"></div>
                <span>Day-Ahead Forecast (D-1)</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot actual"></div>
                <span>Actual Delivered</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot band"></div>
                <span>±MAE Uncertainty</span>
              </div>
            </div>
          </div>

          <div className="chart-wrapper">
            {loading ? (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
                Loading 48 half-hour settlement periods...
              </div>
            ) : dayData ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#F87171' }}>
                No chart data available for selected date.
              </div>
            )}
          </div>
        </div>

        {/* DECISION SUPPORT CALCULATOR */}
        <div className="card-panel">
          <div className="panel-title">
            <h2>
              <Calculator size={18} />
              Day-Ahead Procurement Desk
            </h2>
          </div>

          <div className="calc-content">
            <p className="calc-description">
              Determine thermal procurement required to meet customer demand for <strong>{selectedDate}</strong>, factoring in quantified Elexon forecast bias.
            </p>

            <div className="calc-input-group">
              <label>Consumer Electricity Demand Target:</label>
              <div className="calc-input-wrapper">
                <input 
                  type="number" 
                  step="500" 
                  value={consumerDemand} 
                  onChange={(e) => setConsumerDemand(Number(e.target.value) || 0)}
                />
                <span className="calc-input-unit">MW</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
              <button 
                onClick={() => setBufferMode("pct")}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: bufferMode === "pct" ? '1.5px solid #FCF1D0' : '1px solid #22396F',
                  background: bufferMode === "pct" ? '#22396F' : 'transparent',
                  color: bufferMode === "pct" ? '#FCF1D0' : '#94A3B8',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Adaptive MAPE ({summary?.mape_percent || 22.4}%)
              </button>
              <button 
                onClick={() => setBufferMode("p90")}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: bufferMode === "p90" ? '1.5px solid #FCF1D0' : '1px solid #22396F',
                  background: bufferMode === "p90" ? '#22396F' : 'transparent',
                  color: bufferMode === "p90" ? '#FCF1D0' : '#94A3B8',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                P90 Empirical Cap (+{Math.round(summary?.p90_thermal_buffer_mw || 3200)} MW)
              </button>
            </div>

            <div className="calc-results-box">
              <div className="calc-row">
                <span>Avg Forecasted Wind:</span>
                <span className="val">{Math.round(avgForecast).toLocaleString()} MW</span>
              </div>
              <div className="calc-row">
                <span>Safety Deduction ({bufferMode === "pct" ? 'Adaptive %' : 'P90'}):</span>
                <span className="val" style={{ color: '#F87171' }}>-{Math.round(appliedBuffer).toLocaleString()} MW</span>
              </div>
              <div className="calc-row">
                <span>Risk-Adjusted Wind Credit:</span>
                <span className="val" style={{ color: '#34D399' }}>{Math.round(conservativeWind).toLocaleString()} MW</span>
              </div>
              <div className="calc-row divider final">
                <span>Thermal Power to Procure:</span>
                <span className="val">{Math.round(thermalToProcure).toLocaleString()} MW</span>
              </div>
            </div>

            <div className="advice-banner">
              <strong>Quantified Error Insight:</strong> Due to a consistent <strong>+{Math.round(summary?.mean_bias_mw || 1852)} MW</strong> over-forecast bias in Elexon's D-1 forecasts, procuring <strong>{Math.round(thermalToProcure).toLocaleString()} MW</strong> hedges against delivery shortfall risks under wholesale market rules.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
