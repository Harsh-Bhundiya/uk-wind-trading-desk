import { useState, useEffect } from 'react';
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
  AlertCircle,
  ChevronLeft,
  ChevronRight
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

const RAW_API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? 'http://localhost:8000' : 'https://uk-wind-trading-desk.onrender.com');
const API_BASE = String(RAW_API_BASE).trim().replace(/\/+$/, '');

const DEFAULT_DATE = '2026-01-15';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v) => (isNum(v) ? Math.round(v).toLocaleString() : '—');
const fmtMW = (v, prefix = '') => (isNum(v) ? `${prefix}${Math.round(v).toLocaleString()} MW` : '—');

function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed (HTTP ${res.status})`);
  }
  return res.json();
}

export default function App() {
  const [systemInfo, setSystemInfo] = useState(null);
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(DEFAULT_DATE);
  const [summary, setSummary] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [consumerDemand, setConsumerDemand] = useState(15000);
  const [bufferMode, setBufferMode] = useState('p90');

  const isMobile = useMediaQuery('(max-width: 599px)');

  useEffect(() => {
    let cancelled = false;
    async function initDashboard() {
      try {
        const [infoJson, datesJson, summaryJson] = await Promise.all([
          getJson(`${API_BASE}/`),
          getJson(`${API_BASE}/api/dates`),
          getJson(`${API_BASE}/api/summary-metrics`)
        ]);
        if (cancelled) return;
        const list = datesJson.dates || [];
        setSystemInfo(infoJson);
        setDates(list);
        setSummary(summaryJson);
        if (list.length > 0) {
          setSelectedDate((cur) => (list.includes(cur) ? cur : list.includes(DEFAULT_DATE) ? DEFAULT_DATE : list[0]));
        }
      } catch (err) {
        console.error('Dashboard init error:', err);
        if (!cancelled) {
          setErrorMsg('Unable to reach the trading backend. Check your connection or try again.');
        }
      }
    }
    initDashboard();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!selectedDate) return undefined;
    let cancelled = false;
    async function fetchDayData() {
      setLoading(true);
      try {
        const data = await getJson(`${API_BASE}/api/day-forecast?date=${selectedDate}`);
        if (cancelled) return;
        setDayData(data);
        setErrorMsg(null);
      } catch (err) {
        console.error('Day fetch error:', err);
        if (cancelled) return;
        setDayData(null);
        setErrorMsg(`Could not load settlement data for ${selectedDate}. ${err.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchDayData();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, reloadKey]);

  const series = dayData?.time_series || [];
  const dateIndex = dates.indexOf(selectedDate);

  const chartData = {
    labels: series.map((s) => s.time_label),
    datasets: [
      {
        label: 'Day-Ahead Forecast (D-1 As-Of)',
        data: series.map((s) => s.forecast_mw),
        borderColor: '#FCF1D0',
        backgroundColor: '#FCF1D0',
        borderWidth: isMobile ? 2 : 2.5,
        tension: 0.25,
        pointRadius: isMobile ? 0 : 1.5,
        pointHoverRadius: 5
      },
      {
        label: 'Actual Wind Delivered',
        data: series.map((s) => s.actual_mw),
        borderColor: '#38BDF8',
        backgroundColor: '#38BDF8',
        borderWidth: isMobile ? 1.8 : 2.2,
        borderDash: [4, 4],
        tension: 0.25,
        pointRadius: isMobile ? 0 : 1.5,
        pointHoverRadius: 5
      },
      {
        label: 'Uncertainty Upper (+MAE)',
        data: series.map((s) => s.uncertainty_upper_mw),
        borderColor: 'transparent',
        backgroundColor: 'rgba(252, 241, 208, 0.08)',
        fill: '+1',
        pointRadius: 0
      },
      {
        label: 'Uncertainty Lower (-MAE)',
        data: series.map((s) => s.uncertainty_lower_mw),
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        fill: false,
        pointRadius: 0
      }
    ]
  };

  const tickStep = isMobile ? 8 : 4;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0D1C42',
        titleColor: '#FCF1D0',
        bodyColor: '#FFFFFF',
        borderColor: '#22396F',
        borderWidth: 1,
        padding: isMobile ? 8 : 12,
        titleFont: { size: isMobile ? 12 : 13 },
        bodyFont: { size: isMobile ? 11 : 12 },
        callbacks: {
          label: (context) => {
            if (context.dataset.label.includes('Uncertainty')) return null;
            return ` ${context.dataset.label}: ${isNum(context.raw) ? context.raw.toLocaleString() : '—'} MW`;
          },
          afterBody: (items) => {
            const slot = series[items[0]?.dataIndex];
            if (!slot) return [];
            const published = slot.publish_time ? `${slot.publish_time.replace('T', ' ').slice(0, 16)}Z` : '—';
            return [
              `Deviation: ${slot.error_mw > 0 ? '+' : ''}${slot.error_mw.toLocaleString()} MW`,
              `Published: ${published}`,
              `Lead before auction close: ${slot.lead_time_hours}h`
            ];
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(34, 57, 111, 0.25)' },
        ticks: {
          color: '#94A3B8',
          font: { size: isMobile ? 10 : 11 },
          maxRotation: 0,
          autoSkip: false,
          callback(val, index) {
            return index % tickStep === 0 ? this.getLabelForValue(val) : '';
          }
        }
      },
      y: {
        grid: { color: 'rgba(34, 57, 111, 0.25)' },
        ticks: {
          color: '#94A3B8',
          font: { size: isMobile ? 10 : 11 },
          maxTicksLimit: isMobile ? 6 : 8,
          callback: (val) => (isMobile ? `${(val / 1000).toFixed(0)}k` : `${val.toLocaleString()} MW`)
        },
        title: {
          display: isMobile,
          text: 'MW',
          color: '#94A3B8',
          font: { size: 10 }
        }
      }
    }
  };

  const avgForecast = series.length
    ? series.reduce((acc, curr) => acc + curr.forecast_mw, 0) / series.length
    : null;

  const p90 = summary?.p90_thermal_buffer_mw;
  const mape = summary?.mape_percent;
  const canCalculate = isNum(avgForecast) && isNum(p90) && isNum(mape);

  let appliedBuffer = null;
  let conservativeWind = null;
  let thermalToProcure = null;
  if (canCalculate) {
    appliedBuffer = bufferMode === 'pct' ? avgForecast * (mape / 100) : Math.min(avgForecast * 0.9, p90);
    conservativeWind = Math.max(0, avgForecast - appliedBuffer);
    thermalToProcure = Math.max(0, consumerDemand - conservativeWind);
  }

  const goToDate = (offset) => {
    const next = dates[dateIndex + offset];
    if (next) setSelectedDate(next);
  };

  return (
    <div className="dashboard-container">
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">
            <Zap size={22} />
          </div>
          <div className="header-title">
            <h1>
              GRIDBRICKS<span>UK Wind Day-Ahead Trading Desk</span>
            </h1>
            <p>
              Elexon BMRS January 2026 • Cutoff: {systemInfo?.gate_closure_cutoff || 'D-1 09:20:00Z (GB Day-Ahead Auction Gate Closure)'}
            </p>
          </div>
        </div>

        <div className="header-controls">
          <div className="date-picker-box">
            <Calendar size={16} color="#94A3B8" style={{ marginLeft: 8, flex: '0 0 auto' }} />
            <span className="date-label">Delivery Day</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous day"
              onClick={() => goToDate(-1)}
              disabled={dateIndex <= 0}
            >
              <ChevronLeft size={18} />
            </button>
            <select
              aria-label="Delivery day"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            >
              {dates.length === 0 && <option value={selectedDate}>{selectedDate}</option>}
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next day"
              onClick={() => goToDate(1)}
              disabled={dateIndex < 0 || dateIndex >= dates.length - 1}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <a
            href={`${API_BASE}/api/export-csv`}
            className="btn-export"
            download
            title="Download the verified 1,488-row dataset as CSV"
          >
            <Download size={16} />
            Export CSV
          </a>
        </div>
      </header>

      {errorMsg && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      <section className="metrics-grid">
        <div className="metric-card highlight">
          <div className="metric-header">
            <span>True Day-Ahead MAE</span>
            <AlertTriangle size={18} color="#FCF1D0" />
          </div>
          <div className="metric-value cream">{isNum(summary?.mae_mw) ? `±${fmt(summary.mae_mw)} MW` : '—'}</div>
          <div className="metric-footer">
            <Clock size={13} color="#94A3B8" />
            <span>
              {isNum(summary?.avg_lead_time_hours)
                ? `Avg ${summary.avg_lead_time_hours}h lead time ahead of delivery`
                : 'Lead time unavailable'}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Over-Forecast Bias (MBE)</span>
            <TrendingUp size={18} color="#38BDF8" />
          </div>
          <div className="metric-value red">{fmtMW(summary?.mean_bias_mw, '+')}</div>
          <div className="metric-footer">
            <span>
              {isNum(summary?.over_forecast_percentage)
                ? `Wind over-predicted in ${summary.over_forecast_percentage}% of periods`
                : 'Bias share unavailable'}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>Percentage Error (MAPE)</span>
            <TrendingUp size={18} color="#34D399" />
          </div>
          <div className="metric-value">{isNum(mape) ? `${mape}%` : '—'}</div>
          <div className="metric-footer">
            <span>
              {isNum(summary?.settlement_periods_analyzed)
                ? `Across ${summary.settlement_periods_analyzed.toLocaleString()} settlement periods (D-1 09:20Z)`
                : 'Settlement periods unavailable'}
            </span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span>P90 Deficit Buffer</span>
            <ShieldCheck size={18} color="#FCF1D0" />
          </div>
          <div className="metric-value cream">{fmtMW(p90, '+')}</div>
          <div className="metric-footer">
            <span>90th percentile worst-case delivery shortfall</span>
          </div>
        </div>
      </section>

      <section className="main-grid">
        <div className="card-panel">
          <div className="panel-title">
            <h2>
              <Wind size={18} />
              48-Period Day-Ahead Wind Generation Profile
            </h2>
            <div className="chart-legend-box">
              <div className="legend-item">
                <div className="legend-dot forecast"></div>
                <span>Day-Ahead Forecast</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot actual"></div>
                <span>Actual Delivered</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot band"></div>
                <span>±MAE Band</span>
              </div>
            </div>
          </div>

          <div className="chart-wrapper">
            {loading ? (
              <div className="chart-state">Loading 48 half-hour settlement periods...</div>
            ) : dayData ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="chart-state error">No chart data available for the selected date.</div>
            )}
          </div>

          {dayData && !loading && (
            <div className="day-stats">
              <div className="day-stat">
                <small>Day MAE</small>
                <strong>{fmtMW(dayData.day_mae_mw)}</strong>
              </div>
              <div className="day-stat">
                <small>Forecast energy</small>
                <strong>{isNum(dayData.total_forecast_gwh) ? `${dayData.total_forecast_gwh} GWh` : '—'}</strong>
              </div>
              <div className="day-stat">
                <small>Actual energy</small>
                <strong>{isNum(dayData.total_actual_gwh) ? `${dayData.total_actual_gwh} GWh` : '—'}</strong>
              </div>
              <div className="day-stat">
                <small>Peak (fcst / actual)</small>
                <strong>
                  {fmt(dayData.peak_forecast_mw)} / {fmt(dayData.peak_actual_mw)}
                </strong>
              </div>
            </div>
          )}
        </div>

        <div className="card-panel">
          <div className="panel-title">
            <h2>
              <Calculator size={18} />
              Day-Ahead Procurement Desk
            </h2>
          </div>

          <div className="calc-content">
            <p className="calc-description">
              Thermal power needed to meet demand on <strong>{selectedDate}</strong> after deducting a safety buffer from the wind forecast available at auction close.
            </p>

            <div className="calc-input-group">
              <label htmlFor="demand">Consumer electricity demand</label>
              <div className="calc-input-wrapper">
                <input
                  id="demand"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="500"
                  value={consumerDemand}
                  onChange={(e) => setConsumerDemand(Math.max(0, Number(e.target.value) || 0))}
                />
                <span className="calc-input-unit">MW</span>
              </div>
            </div>

            <div className="segmented" role="group" aria-label="Safety buffer method">
              <button type="button" aria-pressed={bufferMode === 'pct'} onClick={() => setBufferMode('pct')}>
                Adaptive MAPE ({isNum(mape) ? `${mape}%` : '—'})
              </button>
              <button type="button" aria-pressed={bufferMode === 'p90'} onClick={() => setBufferMode('p90')}>
                P90 cap ({fmtMW(p90, '+')})
              </button>
            </div>

            <div className="calc-results-box">
              <div className="calc-row">
                <span>Avg forecasted wind</span>
                <span className="val">{fmtMW(avgForecast)}</span>
              </div>
              <div className="calc-row">
                <span>Safety deduction ({bufferMode === 'pct' ? 'MAPE' : 'P90'})</span>
                <span className="val red">{isNum(appliedBuffer) ? `-${fmt(appliedBuffer)} MW` : '—'}</span>
              </div>
              <div className="calc-row">
                <span>Risk-adjusted wind credit</span>
                <span className="val green">{fmtMW(conservativeWind)}</span>
              </div>
              <div className="calc-row divider final">
                <span>Thermal to procure</span>
                <span className="val">{fmtMW(thermalToProcure)}</span>
              </div>
            </div>

            <div className="advice-banner">
              <strong>Quantified error insight:</strong>{' '}
              {isNum(summary?.mean_bias_mw) && isNum(thermalToProcure)
                ? `Elexon's D-1 wind forecasts over-predicted by ${fmt(summary.mean_bias_mw)} MW on average in January 2026, so planning for ${fmt(thermalToProcure)} MW of thermal cover hedges against delivery shortfall.`
                : 'Buffer insight is shown once backend metrics have loaded.'}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
