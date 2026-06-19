import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Line } from "recharts";
import Papa from "papaparse";

// ── Fonts ──────────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Mono:wght@300;400;500&family=Instrument+Serif:ital@0;1&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

// ── Default demo data ──────────────────────────────────────────────────
const DEFAULT_REVENUE = [
  { month: "Jan", revenue: 412000, target: 380000, profit: 89000 },
  { month: "Feb", revenue: 438000, target: 400000, profit: 102000 },
  { month: "Mar", revenue: 391000, target: 420000, profit: 78000 },
  { month: "Apr", revenue: 502000, target: 440000, profit: 134000 },
  { month: "May", revenue: 548000, target: 460000, profit: 156000 },
  { month: "Jun", revenue: 521000, target: 480000, profit: 141000 },
  { month: "Jul", revenue: 589000, target: 500000, profit: 178000 },
  { month: "Aug", revenue: 634000, target: 520000, profit: 203000 },
  { month: "Sep", revenue: 611000, target: 540000, profit: 188000 },
  { month: "Oct", revenue: 672000, target: 560000, profit: 221000 },
  { month: "Nov", revenue: 701000, target: 580000, profit: 239000 },
  { month: "Dec", revenue: 748000, target: 600000, profit: 267000 },
];

const DEFAULT_DEPT = [
  { dept: "Sales", efficiency: 87, headcount: 42, cost: 2.1 },
  { dept: "Marketing", efficiency: 74, headcount: 18, cost: 1.4 },
  { dept: "Ops", efficiency: 91, headcount: 61, cost: 3.8 },
  { dept: "R&D", efficiency: 68, headcount: 29, cost: 4.2 },
  { dept: "Finance", efficiency: 95, headcount: 14, cost: 0.9 },
  { dept: "Support", efficiency: 82, headcount: 33, cost: 1.7 },
];

const REPORTS = [
  { id: "exec", label: "Executive Summary", icon: "◈" },
  { id: "risk", label: "Risk Analysis", icon: "⬡" },
  { id: "growth", label: "Growth Forecast", icon: "△" },
  { id: "ops", label: "Operational Audit", icon: "◻" },
];

const CSV_TEMPLATES = {
  revenue: `month,revenue,target,profit\nJan,412000,380000,89000\nFeb,438000,400000,102000\nMar,391000,420000,78000`,
  dept: `dept,efficiency,headcount,cost\nSales,87,42,2.1\nMarketing,74,18,1.4\nOps,91,61,3.8`,
};

// ── Helpers ────────────────────────────────────────────────────────────
function calcKPIs(revData, deptData) {
  const totalRev = revData.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const totalProfit = revData.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const margin = totalRev > 0 ? ((totalProfit / totalRev) * 100).toFixed(1) : "0.0";
  const totalCost = deptData.reduce((s, d) => s + (Number(d.cost) || 0), 0);
  const avgEff = deptData.length > 0
    ? (deptData.reduce((s, d) => s + (Number(d.efficiency) || 0), 0) / deptData.length).toFixed(0)
    : "0";
  const fmt = (n) => n >= 1000000 ? `£${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `£${(n / 1000).toFixed(0)}k` : `£${n}`;
  return [
    { label: "Total Revenue", value: fmt(totalRev), delta: "+18.4%", up: true, sub: "from uploaded data" },
    { label: "Net Profit Margin", value: `${margin}%`, delta: "+4.1pp", up: true, sub: "industry avg 22%" },
    { label: "Dept Operating Cost", value: `£${totalCost.toFixed(1)}M`, delta: "-3.2%", up: true, sub: "combined dept cost" },
    { label: "Avg Efficiency", value: `${avgEff}%`, delta: "+9pts", up: Number(avgEff) >= 80, sub: "across all depts" },
  ];
}

// ── AI report ──────────────────────────────────────────────────────────
async function generateAIReport(type, revData, deptData, setter) {
  const totalRev = revData.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const totalProfit = revData.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const margin = totalRev > 0 ? ((totalProfit / totalRev) * 100).toFixed(1) : 0;
  const avgEff = deptData.length > 0
    ? (deptData.reduce((s, d) => s + (Number(d.efficiency) || 0), 0) / deptData.length).toFixed(0) : 0;
  const deptSummary = deptData.map(d => `${d.dept}: efficiency ${d.efficiency}%, headcount ${d.headcount}`).join("; ");

  const base = `Company data — Revenue: £${(totalRev/1000000).toFixed(2)}M, Profit margin: ${margin}%, Avg efficiency: ${avgEff}%, Departments: ${deptSummary}.`;

  const prompts = {
    exec: `You are a senior business analyst. Write a concise 4-paragraph executive summary using this data: ${base} Cover: performance highlights, strategic position, key risks, and one bold recommendation. Flowing prose only.`,
    risk: `You are a risk intelligence officer. Write a 4-paragraph risk analysis using: ${base} Cover: financial risk, operational risk, talent/org risk, and one mitigation priority. Authoritative, no fluff.`,
    growth: `You are a strategic growth advisor. Write a 4-paragraph growth forecast using: ${base} Forecast next 12 months, identify two expansion vectors, note market conditions, give a bold projection.`,
    ops: `You are an operations director. Write a 4-paragraph operational audit using: ${base} Identify weakest area, commend strongest, recommend one cross-departmental initiative, end with a measurable 90-day target.`,
  };

  setter("loading");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompts[type] }],
      }),
    });
    const data = await res.json();
    setter(data.content?.find(b => b.type === "text")?.text || "Unable to generate.");
  } catch {
    setter("Error generating report. Please try again.");
  }
}

// ── PDF Export ─────────────────────────────────────────────────────────
function exportPDF(reportTitle, reportText, kpis, revData) {
  const win = window.open("", "_blank");
  const totalRev = revData.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  win.document.write(`<!DOCTYPE html><html><head><title>TranquilloIQ Report</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; color: #1a1a2e; line-height: 1.8; }
    h1 { font-size: 28px; color: #1a1a2e; border-bottom: 3px solid #c8a96e; padding-bottom: 12px; }
    h2 { font-size: 16px; color: #8b6f3e; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 32px; }
    .meta { color: #888; font-size: 12px; font-family: monospace; margin-bottom: 32px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 16px; margin: 24px 0; }
    .kpi { background: #f9f6f0; border-left: 4px solid #c8a96e; padding: 14px 18px; border-radius: 4px; }
    .kpi-val { font-size: 22px; font-weight: bold; color: #1a1a2e; }
    .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-top: 4px; }
    .report-body { font-size: 15px; color: #333; white-space: pre-wrap; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
    .table th { background: #1a1a2e; color: #c8a96e; padding: 8px 12px; text-align: left; }
    .table td { border-bottom: 1px solid #eee; padding: 8px 12px; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #aaa; font-family: monospace; }
    @media print { button { display: none; } }
  </style></head><body>
  <h1>TranquilloIQ · ${reportTitle}</h1>
  <div class="meta">Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · TranquilloIQ AI Engine · Confidential</div>
  <h2>Key Performance Indicators</h2>
  <div class="kpi-grid">
    ${kpis.map(k => `<div class="kpi"><div class="kpi-val">${k.value}</div><div class="kpi-label">${k.label} <span style="color:${k.up?"#4caf7d":"#e05a5a"}">${k.delta}</span></div></div>`).join("")}
  </div>
  <h2>Revenue Data</h2>
  <table class="table">
    <tr><th>Period</th><th>Revenue</th><th>Target</th><th>Profit</th></tr>
    ${revData.slice(0,12).map(r => `<tr><td>${r.month||r[Object.keys(r)[0]]}</td><td>£${Number(r.revenue||0).toLocaleString()}</td><td>£${Number(r.target||0).toLocaleString()}</td><td>£${Number(r.profit||0).toLocaleString()}</td></tr>`).join("")}
  </table>
  <h2>AI Analysis: ${reportTitle}</h2>
  <div class="report-body">${reportText}</div>
  <div class="footer">TRANQUILLOIQ ENTERPRISE · AI BUSINESS INTELLIGENCE PLATFORM · v2.4.1 · tranquilloiq.io</div>
  <br><button onclick="window.print()" style="background:#c8a96e;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;">Print / Save as PDF</button>
  </body></html>`);
  win.document.close();
}

// ── Tooltip ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0e1117", border: "1px solid #2a2f3e", padding: "10px 14px", borderRadius: 6 }}>
      <p style={{ color: "#8b92a5", fontSize: 11, fontFamily: "DM Mono", marginBottom: 6 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontFamily: "DM Mono", fontSize: 12, margin: "2px 0" }}>
          {p.name}: {typeof p.value === "number" && p.value > 1000 ? `£${(p.value / 1000).toFixed(0)}k` : p.value}
        </p>
      ))}
    </div>
  );
};

// ── Gauge ──────────────────────────────────────────────────────────────
function Gauge({ value, label, color }) {
  const r = 36, cx = 44, cy = 44, arc = 2 * Math.PI * r;
  const dash = arc * Math.min(Number(value) / 100, 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={88} height={88}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2430" strokeWidth={8} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${arc}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "stroke-dasharray 1s ease" }} />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="#e8eaf2" fontSize={13} fontFamily="DM Mono" fontWeight={500}>{value}%</text>
      </svg>
      <span style={{ fontSize: 10, color: "#8b92a5", fontFamily: "DM Mono", textAlign: "center" }}>{label}</span>
    </div>
  );
}

// ── CSV Upload Modal ───────────────────────────────────────────────────
function CSVModal({ onClose, onUpload }) {
  const [tab, setTab] = useState("revenue");
  const [error, setError] = useState("");
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        if (res.errors.length) { setError("CSV parse error: " + res.errors[0].message); return; }
        const rows = res.data;
        if (tab === "revenue") {
          if (!rows[0]?.revenue) { setError("CSV must have columns: month, revenue, target, profit"); return; }
          onUpload("revenue", rows.map(r => ({ ...r, revenue: Number(r.revenue), target: Number(r.target), profit: Number(r.profit) })));
        } else {
          if (!rows[0]?.dept) { setError("CSV must have columns: dept, efficiency, headcount, cost"); return; }
          onUpload("dept", rows.map(r => ({ ...r, efficiency: Number(r.efficiency), headcount: Number(r.headcount), cost: Number(r.cost) })));
        }
        onClose();
      },
      error: () => setError("Could not read file."),
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATES[tab]], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `template_${tab}.csv`; a.click();
  };

  const s = {
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
    box: { background: "#0e1117", border: "1px solid #2a2f3e", borderRadius: 14, padding: "32px", width: 480, maxWidth: "90vw" },
    title: { fontSize: 16, fontWeight: 700, color: "#e8eaf2", marginBottom: 4 },
    sub: { fontSize: 12, color: "#5a6070", fontFamily: "DM Mono", marginBottom: 24 },
    tabs: { display: "flex", gap: 8, marginBottom: 20 },
    tab: (a) => ({ padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "DM Mono", border: "1px solid", borderColor: a ? "#c8a96e" : "#2a2f3e", background: a ? "rgba(200,169,110,0.1)" : "transparent", color: a ? "#c8a96e" : "#8b92a5" }),
    dropzone: {
      border: "2px dashed #2a2f3e", borderRadius: 10, padding: "36px 20px",
      textAlign: "center", cursor: "pointer", marginBottom: 16,
      transition: "border-color 0.2s",
    },
    hint: { fontSize: 11, color: "#5a6070", fontFamily: "DM Mono", marginTop: 8 },
    row: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 },
    btnGhost: { background: "transparent", border: "1px solid #2a2f3e", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontFamily: "DM Mono", color: "#8b92a5", cursor: "pointer" },
    btnGold: { background: "linear-gradient(135deg,#c8a96e,#8b6f3e)", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 12, fontFamily: "DM Mono", color: "#080b10", fontWeight: 700, cursor: "pointer" },
    error: { color: "#e05a5a", fontSize: 11, fontFamily: "DM Mono", marginTop: 8 },
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.title}>Upload CSV Data</div>
        <div style={s.sub}>Replace demo data with your own company figures</div>
        <div style={s.tabs}>
          {["revenue", "dept"].map(t => (
            <button key={t} style={s.tab(tab === t)} onClick={() => { setTab(t); setError(""); }}>
              {t === "revenue" ? "Revenue Data" : "Department Data"}
            </button>
          ))}
        </div>
        <div style={s.dropzone} onClick={() => fileRef.current.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>△</div>
          <div style={{ fontSize: 13, color: "#8b92a5" }}>Drop your CSV here or <span style={{ color: "#c8a96e" }}>click to browse</span></div>
          <div style={s.hint}>
            {tab === "revenue" ? "Required columns: month, revenue, target, profit" : "Required columns: dept, efficiency, headcount, cost"}
          </div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
        </div>
        {error && <div style={s.error}>⚠ {error}</div>}
        <div style={s.row}>
          <button style={s.btnGhost} onClick={downloadTemplate}>↓ Download Template</button>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────
export default function TranquilloIQ() {
  const [revenueData, setRevenueData] = useState(DEFAULT_REVENUE);
  const [deptData, setDeptData] = useState(DEFAULT_DEPT);
  const [kpis, setKpis] = useState(() => calcKPIs(DEFAULT_REVENUE, DEFAULT_DEPT));
  const [activeReport, setActiveReport] = useState(null);
  const [reportContent, setReportContent] = useState({});
  const [generating, setGenerating] = useState(null);
  const [activeNav, setActiveNav] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCSV, setShowCSV] = useState(false);
  const [dataSource, setDataSource] = useState("demo");
  const reportRef = useRef(null);

  const handleUpload = (type, rows) => {
    if (type === "revenue") {
      setRevenueData(rows);
      setKpis(calcKPIs(rows, deptData));
      setDataSource("uploaded");
    } else {
      setDeptData(rows);
      setKpis(calcKPIs(revenueData, rows));
      setDataSource("uploaded");
    }
    setReportContent({});
    setActiveReport(null);
  };

  const handleGenerate = async (id) => {
    setGenerating(id);
    setActiveReport(id);
    await generateAIReport(id, revenueData, deptData, (val) => {
      setReportContent(prev => ({ ...prev, [id]: val }));
      if (val !== "loading") setGenerating(null);
    });
    setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const handleExportPDF = () => {
    if (!activeReport || !reportContent[activeReport] || reportContent[activeReport] === "loading") return;
    const label = REPORTS.find(r => r.id === activeReport)?.label || "Report";
    exportPDF(label, reportContent[activeReport], kpis, revenueData);
  };

  const navItems = [
    { id: "overview", label: "Overview", icon: "⊞" },
    { id: "revenue", label: "Revenue", icon: "◈" },
    { id: "departments", label: "Departments", icon: "⬡" },
    { id: "reports", label: "AI Reports", icon: "△" },
  ];

  const activeReportObj = REPORTS.find(r => r.id === activeReport);

  const S = {
    root: { background: "#080b10", minHeight: "100vh", fontFamily: "Syne, sans-serif", color: "#e8eaf2", display: "flex", overflow: "hidden" },
    sidebar: { width: sidebarOpen ? 220 : 64, background: "#0b0f16", borderRight: "1px solid #1a1f2e", display: "flex", flexDirection: "column", transition: "width 0.3s ease", flexShrink: 0, zIndex: 10 },
    logo: { padding: sidebarOpen ? "24px 20px 20px" : "24px 16px 20px", borderBottom: "1px solid #1a1f2e", display: "flex", alignItems: "center", gap: 10 },
    logoMark: { width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#c8a96e,#8b6f3e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 },
    logoText: { fontSize: 17, fontWeight: 800, letterSpacing: "-0.3px", color: "#e8eaf2", overflow: "hidden", whiteSpace: "nowrap", opacity: sidebarOpen ? 1 : 0, transition: "opacity 0.2s" },
    nav: { padding: "16px 10px", flex: 1 },
    navItem: (a) => ({ display: "flex", alignItems: "center", gap: 10, padding: sidebarOpen ? "10px 12px" : "10px", borderRadius: 8, cursor: "pointer", marginBottom: 2, background: a ? "rgba(200,169,110,0.1)" : "transparent", color: a ? "#c8a96e" : "#8b92a5", fontSize: 13, fontWeight: a ? 600 : 400, transition: "all 0.15s", whiteSpace: "nowrap", overflow: "hidden", border: a ? "1px solid rgba(200,169,110,0.2)" : "1px solid transparent" }),
    topbar: { background: "#0b0f16", borderBottom: "1px solid #1a1f2e", padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 5 },
    badge: { background: "rgba(200,169,110,0.12)", color: "#c8a96e", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontFamily: "DM Mono", border: "1px solid rgba(200,169,110,0.2)" },
    badgeLive: { background: "rgba(76,175,125,0.12)", color: "#4caf7d", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontFamily: "DM Mono", border: "1px solid rgba(76,175,125,0.2)" },
    content: { padding: "32px", flex: 1 },
    grid4: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 },
    kpiCard: { background: "#0e1117", border: "1px solid #1e2430", borderRadius: 12, padding: "20px 22px", position: "relative", overflow: "hidden" },
    kpiTop: { fontSize: 11, color: "#8b92a5", fontFamily: "DM Mono", letterSpacing: "0.05em", marginBottom: 8 },
    kpiVal: { fontSize: 24, fontWeight: 800, color: "#e8eaf2", letterSpacing: "-0.5px", marginBottom: 6, fontFamily: "Instrument Serif" },
    kpiDelta: (up) => ({ fontSize: 11, fontFamily: "DM Mono", color: up ? "#4caf7d" : "#e05a5a", background: up ? "rgba(76,175,125,0.1)" : "rgba(224,90,90,0.1)", padding: "2px 7px", borderRadius: 4, display: "inline-block" }),
    kpiSub: { fontSize: 10, color: "#5a6070", fontFamily: "DM Mono", marginTop: 6 },
    kpiAccent: { position: "absolute", right: 16, top: 16, width: 36, height: 36, borderRadius: "50%", background: "rgba(200,169,110,0.06)", border: "1px solid rgba(200,169,110,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 },
    grid2: { display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 24 },
    card: { background: "#0e1117", border: "1px solid #1e2430", borderRadius: 12, padding: "24px" },
    cardTitle: { fontSize: 12, fontWeight: 700, color: "#c8a96e", letterSpacing: "0.08em", marginBottom: 4 },
    cardSub: { fontSize: 11, color: "#5a6070", fontFamily: "DM Mono", marginBottom: 20 },
    reportGrid: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 24 },
    reportBtn: (a) => ({ background: a ? "rgba(200,169,110,0.08)" : "#0e1117", border: a ? "1px solid rgba(200,169,110,0.4)" : "1px solid #1e2430", borderRadius: 10, padding: "16px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "all 0.2s" }),
    reportIcon: { width: 36, height: 36, borderRadius: 8, background: "rgba(200,169,110,0.1)", border: "1px solid rgba(200,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#c8a96e", flexShrink: 0 },
    genBtn: { marginLeft: "auto", background: "linear-gradient(135deg,#c8a96e,#8b6f3e)", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontFamily: "DM Mono", color: "#080b10", cursor: "pointer", fontWeight: 600 },
    reportBox: { background: "#090c12", border: "1px solid #1e2430", borderRadius: 12, padding: "28px 32px", marginBottom: 24 },
    reportHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #1a1f2e" },
    reportText: { fontSize: 14, lineHeight: 1.85, color: "#b0b8cc", fontFamily: "Instrument Serif", whiteSpace: "pre-wrap" },
    pulse: { display: "inline-flex", alignItems: "center", gap: 8, color: "#c8a96e", fontFamily: "DM Mono", fontSize: 12 },
    dot: { width: 8, height: 8, borderRadius: "50%", background: "#c8a96e", animation: "pulse 1.2s ease-in-out infinite" },
    gaugeGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 8 },
    toggler: { padding: "12px 16px", borderTop: "1px solid #1a1f2e", cursor: "pointer", fontSize: 12, color: "#5a6070", display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "flex-end" : "center" },
    csvBtn: { background: "rgba(200,169,110,0.08)", border: "1px solid rgba(200,169,110,0.25)", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontFamily: "DM Mono", color: "#c8a96e", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
    pdfBtn: { background: "rgba(76,175,125,0.08)", border: "1px solid rgba(76,175,125,0.25)", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontFamily: "DM Mono", color: "#4caf7d", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
    divider: { height: 1, background: "#1a1f2e", margin: "4px 0 16px" },
  };

  return (
    <div style={S.root}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#080b10} ::-webkit-scrollbar-thumb{background:#1e2430;border-radius:2px}
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {showCSV && <CSVModal onClose={() => setShowCSV(false)} onUpload={handleUpload} />}

      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.logo}>
          <div style={S.logoMark}>◈</div>
          <span style={S.logoText}>TranquilloIQ</span>
        </div>
        <div style={S.nav}>
          {navItems.map(n => (
            <div key={n.id} style={S.navItem(activeNav === n.id)} onClick={() => setActiveNav(n.id)}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{n.icon}</span>
              {sidebarOpen && <span>{n.label}</span>}
            </div>
          ))}
        </div>
        <div style={S.toggler} onClick={() => setSidebarOpen(p => !p)}>
          {sidebarOpen ? "← collapse" : "→"}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <div style={S.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>{navItems.find(n => n.id === activeNav)?.label}</div>
            <div style={{ fontSize: 12, color: "#8b92a5", fontFamily: "DM Mono" }}>FY 2024 · Enterprise Analytics</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={S.csvBtn} onClick={() => setShowCSV(true)}>↑ Upload CSV</button>
            {activeReport && reportContent[activeReport] && reportContent[activeReport] !== "loading" && (
              <button style={S.pdfBtn} onClick={handleExportPDF}>↓ Export PDF</button>
            )}
            <span style={dataSource === "uploaded" ? S.badgeLive : S.badge}>
              {dataSource === "uploaded" ? "● Live Data" : "◌ Demo Data"}
            </span>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#c8a96e,#5a3e1b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#080b10" }}>A</div>
          </div>
        </div>

        {/* Content */}
        <div style={S.content}>

          {/* KPI Row */}
          <div style={S.grid4}>
            {kpis.map((k, i) => (
              <div key={i} style={S.kpiCard}>
                <div style={S.kpiAccent}>{["◈","△","◻","⬡"][i]}</div>
                <div style={S.kpiTop}>{k.label}</div>
                <div style={S.kpiVal}>{k.value}</div>
                <span style={S.kpiDelta(k.up)}>{k.delta}</span>
                <div style={S.kpiSub}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardTitle}>REVENUE & PROFIT TREND</div>
              <div style={S.cardSub}>Monthly performance vs target</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#c8a96e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#c8a96e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4caf7d" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#4caf7d" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1a1f2e" strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fill: "#5a6070", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#5a6070", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} tickFormatter={v => `£${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#c8a96e" strokeWidth={2} fill="url(#rev)" />
                  <Area type="monotone" dataKey="profit" name="Profit" stroke="#4caf7d" strokeWidth={2} fill="url(#prof)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}>DEPT EFFICIENCY</div>
              <div style={S.cardSub}>Performance scores</div>
              <div style={S.gaugeGrid}>
                {deptData.slice(0, 6).map((d, i) => (
                  <Gauge key={i} value={d.efficiency} label={d.dept}
                    color={d.efficiency >= 90 ? "#4caf7d" : d.efficiency >= 80 ? "#c8a96e" : "#e0855a"} />
                ))}
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <div style={{ ...S.card, marginBottom: 24 }}>
            <div style={S.cardTitle}>HEADCOUNT vs EFFICIENCY PER DEPARTMENT</div>
            <div style={S.cardSub}>From {dataSource === "uploaded" ? "your uploaded data" : "demo data"}</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={deptData} barGap={4}>
                <CartesianGrid stroke="#1a1f2e" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dept" tick={{ fill: "#5a6070", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#5a6070", fontSize: 10, fontFamily: "DM Mono" }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="headcount" name="Headcount" fill="#c8a96e" opacity={0.8} radius={[3,3,0,0]} />
                <Bar dataKey="efficiency" name="Efficiency %" fill="#4caf7d" opacity={0.6} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* AI Reports */}
          <div style={{ ...S.card, marginBottom: 24 }}>
            <div style={S.cardTitle}>AI-GENERATED REPORTS</div>
            <div style={S.cardSub}>Analyses are based on your {dataSource === "uploaded" ? "uploaded" : "demo"} data</div>
            <div style={S.divider} />
            <div style={S.reportGrid}>
              {REPORTS.map(r => (
                <div key={r.id} style={S.reportBtn(activeReport === r.id)}>
                  <div style={S.reportIcon}>{r.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaf2" }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: "#5a6070", fontFamily: "DM Mono", marginTop: 2 }}>AI-powered · ~30s</div>
                  </div>
                  <button style={{ ...S.genBtn, opacity: generating === r.id ? 0.6 : 1 }}
                    onClick={() => handleGenerate(r.id)} disabled={!!generating}>
                    {generating === r.id ? "..." : "Generate"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Report output */}
          {activeReport && (
            <div style={S.reportBox} ref={reportRef}>
              <div style={S.reportHeader}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#c8a96e" }}>{activeReportObj?.icon} {activeReportObj?.label}</div>
                  <div style={{ fontSize: 10, color: "#5a6070", fontFamily: "DM Mono", marginTop: 4 }}>
                    Generated {new Date().toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })} · TranquilloIQ AI Engine
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {reportContent[activeReport] && reportContent[activeReport] !== "loading" && (
                    <>
                      <span style={S.badgeLive}>● Complete</span>
                      <button style={S.pdfBtn} onClick={handleExportPDF}>↓ PDF</button>
                    </>
                  )}
                </div>
              </div>
              {reportContent[activeReport] === "loading" ? (
                <div style={S.pulse}><div style={S.dot} />Generating analysis…</div>
              ) : (
                <div style={S.reportText}>{reportContent[activeReport]}</div>
              )}
            </div>
          )}

          <div style={{ textAlign: "center", padding: "12px 0", borderTop: "1px solid #1a1f2e" }}>
            <span style={{ fontSize: 10, color: "#3a4050", fontFamily: "DM Mono", letterSpacing: "0.1em" }}>
              TRANQUILLOIQ ENTERPRISE · AI BUSINESS INTELLIGENCE PLATFORM · v2.4.1
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
