// Shared by the dashboard (src/App.jsx) and the public API (api/v1/reports.js)
// so the two products cannot drift into producing different analysis from the
// same numbers.

export const REPORT_TYPES = ["exec", "risk", "growth", "ops"];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Condense the caller's rows into the factual preamble every prompt shares. */
export function summariseData(revenue = [], departments = []) {
  const totalRev = revenue.reduce((s, r) => s + num(r.revenue), 0);
  const totalProfit = revenue.reduce((s, r) => s + num(r.profit), 0);
  const margin = totalRev > 0 ? ((totalProfit / totalRev) * 100).toFixed(1) : "0.0";
  const avgEff = departments.length
    ? Math.round(departments.reduce((s, d) => s + num(d.efficiency), 0) / departments.length)
    : 0;
  const deptSummary = departments
    .map((d) => `${d.dept}: efficiency ${num(d.efficiency)}%, headcount ${num(d.headcount)}`)
    .join("; ");

  return (
    `Company data — Revenue: £${(totalRev / 1000000).toFixed(2)}M, ` +
    `Profit margin: ${margin}%, Avg efficiency: ${avgEff}%, ` +
    `Periods: ${revenue.length}, Departments: ${deptSummary || "none supplied"}.`
  );
}

const TEMPLATES = {
  exec: (base) =>
    `You are a senior business analyst. Write a concise 4-paragraph executive summary using this data: ${base} Cover: performance highlights, strategic position, key risks, and one bold recommendation. Flowing prose only.`,
  risk: (base) =>
    `You are a risk intelligence officer. Write a 4-paragraph risk analysis using: ${base} Cover: financial risk, operational risk, talent/org risk, and one mitigation priority. Authoritative, no fluff.`,
  growth: (base) =>
    `You are a strategic growth advisor. Write a 4-paragraph growth forecast using: ${base} Forecast next 12 months, identify two expansion vectors, note market conditions, give a bold projection.`,
  ops: (base) =>
    `You are an operations director. Write a 4-paragraph operational audit using: ${base} Identify weakest area, commend strongest, recommend one cross-departmental initiative, end with a measurable 90-day target.`,
};

export function buildPrompt(reportType, revenue, departments) {
  const template = TEMPLATES[reportType];
  if (!template) return null;
  return template(summariseData(revenue, departments));
}

export const REPORT_SYSTEM = [
  "You write board-level business analysis for a BI dashboard.",
  "Ground every claim in the figures you are given — never invent numbers,",
  "and say so plainly when the data is too thin to support a conclusion.",
  "Flowing prose, no markdown headings, no bullet lists.",
].join(" ");
