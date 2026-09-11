/**
 * dsh-plugin-verify — batch verification helpers (v1.1.0).
 *
 * Pure module: task normalisation, a bounded-concurrency pool (async but
 * deterministic to test with a fake worker), confidence grading per result
 * kind, batch summarisation and a Markdown table. No DSH/Cordis imports.
 */

export const MAX_BATCH_TASKS = 50;

/** Normalize the batch input into an ordered task list. */
export function normalizeTasks({ claims = [], urls = [], packages = [], repos = [], configs = [] } = {}) {
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  const tasks = [];
  const push = (kind, value) => {
    const text = String(value === undefined || value === null ? "" : value).trim();
    if (text.length === 0) return;
    tasks.push({ kind, value: text });
  };
  for (const v of asList(claims)) push("claim", v);
  for (const v of asList(configs)) push("config", v);
  for (const v of asList(urls)) push("url", v);
  for (const v of asList(packages)) push("npm", v);
  for (const v of asList(repos)) push("repo", v);
  return tasks.slice(0, MAX_BATCH_TASKS);
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order.
 * Deterministic: the returned array is indexed like the input.
 */
export async function mapPool(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;
  const run = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: size }, run));
  return results;
}

/** Confidence grading for one batch result (high / medium / low + basis). */
export function confidenceOf(result = {}) {
  const kind = result.kind;
  if (kind === "claim") {
    const hits = Number(result.summary && result.summary.found) || 0;
    if (result.verdict === "verified" && hits >= 2) return { level: "high", basis: [hits + " keyword evidence hits"] };
    if (result.verdict === "verified") return { level: "medium", basis: ["single keyword hit"] };
    if (result.verdict === "partial") return { level: "low", basis: ["partial keyword coverage"] };
    return { level: "low", basis: ["no evidence found"] };
  }
  if (kind === "url") {
    const status = result.summary && result.summary.status;
    if (typeof status !== "number") return { level: "low", basis: ["probe failed"] };
    if (status >= 200 && status < 300) return { level: "high", basis: ["HTTP " + status] };
    if (status >= 300 && status < 400) return { level: "medium", basis: ["redirect HTTP " + status] };
    return { level: "high", basis: ["HTTP " + status] };
  }
  if (kind === "npm" || kind === "repo") {
    if (result.error) return { level: "low", basis: ["probe error"] };
    const exists = result.summary && result.summary.exists;
    if (exists === true) return { level: "high", basis: ["registry confirms it exists"] };
    if (exists === false) return { level: "high", basis: ["registry confirms it is absent"] };
    return { level: "low", basis: ["inconclusive"] };
  }
  if (kind === "config") {
    if (result.error) return { level: "low", basis: ["unreadable"] };
    return { level: "high", basis: [result.ok ? "parsed cleanly" : "parse error located"] };
  }
  return { level: "low", basis: ["unknown task kind"] };
}

/** Batch roll-up: per-kind counts, confidence mix and a conclusion line. */
export function summarizeBatch(results = []) {
  const list = Array.isArray(results) ? results : [];
  const byKind = {};
  const confidence = { high: 0, medium: 0, low: 0 };
  let failed = 0;
  for (const r of list) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const level = r.confidence && r.confidence.level;
    if (level === "high" || level === "medium" || level === "low") confidence[level] += 1;
    if (r.ok !== true) failed += 1;
  }
  const conclusion = list.length === 0
    ? "no tasks supplied"
    : failed === 0
      ? "all " + list.length + " check(s) completed successfully"
      : failed + " of " + list.length + " check(s) failed or were inconclusive";
  return { total: list.length, byKind, confidence, failed, conclusion };
}

/** Markdown table for batch results. */
export function renderBatchTable(results = []) {
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) return "(no tasks)";
  const lines = ["| # | Kind | Target | Result | Confidence | Detail |", "|---|------|--------|--------|------------|--------|"];
  list.forEach((r, i) => {
    const status = r.ok === true ? "ok" : r.ok === false ? "fail" : "?";
    const level = (r.confidence && r.confidence.level) || "?";
    const detail = String(r.detail || r.error || "").replace(/\n/g, " ").replace(/\|/g, "\\|").slice(0, 90);
    const target = String(r.value || "").replace(/\|/g, "\\|").slice(0, 50);
    lines.push("| " + (i + 1) + " | " + r.kind + " | " + target + " | " + status + " | " + level + " | " + detail + " |");
  });
  return lines.join("\n");
}
