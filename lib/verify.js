/**
 * dsh-plugin-verify — pure verification logic.
 *
 * No DSH/Cordis imports; network helpers take an injected fetch implementation
 * so they are unit-testable offline. Covers:
 *   - claim: evidence-based statement checking against file text
 *     (keyword extraction + keyword-hit scoring).
 *   - config: JSON strict validation + YAML structural smoke check.
 *   - url / npm / repo: read-only network probes.
 */

// ---------------------------------------------------------------- keywords
const EN_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "being", "this", "that", "these",
  "those", "it", "its", "at", "by", "from", "as", "not", "no", "do", "does",
  "did", "will", "would", "should", "can", "could", "may", "might", "must",
  "have", "has", "had", "we", "you", "they", "he", "she", "them", "their",
  "our", "your", "my", "me", "there", "here", "what", "which", "who", "whom",
  "when", "where", "why", "how", "all", "any", "some", "more", "most", "other",
  "about", "into", "than", "then", "just", "also", "only", "very", "such",
  "if", "while", "because", "so", "up", "out", "over", "again", "once",
]);

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;
const EN_RE = /[a-zA-Z][a-zA-Z0-9_-]{2,}/g;
const NUM_RE = /\b\d{2,}\b/g;

/**
 * Extract search keywords from a claim statement.
 * CJK runs become single keywords; English words >= 3 chars survive
 * stopword filtering; numbers of 2+ digits are kept.
 * @param {string} claim
 * @param {{max?:number}} [opts]
 * @returns {Array<{term:string, kind:'cjk'|'en'|'num'}>}
 */
export function extractKeywords(claim, opts = {}) {
  const { max = 12 } = opts;
  const out = [];
  const seen = new Set();
  const push = (term, kind) => {
    const t = term.trim().toLowerCase();
    if (t.length === 0 || seen.has(t)) return;
    seen.add(t);
    out.push({ term: t, kind });
  };
  const text = String(claim || "");
  for (const m of text.matchAll(CJK_RE)) push(m[0], "cjk");
  for (const m of text.matchAll(EN_RE)) {
    if (!EN_STOPWORDS.has(m[0].toLowerCase())) push(m[0], "en");
  }
  for (const m of text.matchAll(NUM_RE)) push(m[0], "num");
  return out.slice(0, max);
}

/**
 * Turn per-keyword evidence counts into a verdict.
 * @param {{term:string, hits:number}[]} keywordStats
 * @returns {{verdict:'verified'|'partial'|'unsupported', foundCount:number, totalCount:number, pct:number}}
 */
export function scoreClaim(keywordStats) {
  const total = keywordStats.length;
  const found = keywordStats.filter((k) => k.hits > 0).length;
  const pct = total === 0 ? 0 : Math.round((found / total) * 100);
  let verdict = "unsupported";
  if (total === 0) verdict = "unsupported";
  else if (pct >= 60) verdict = "verified";
  else if (pct >= 30) verdict = "partial";
  return { verdict, foundCount: found, totalCount: total, pct };
}

/** Escape a term for safe use inside a RegExp. */
const SPECIAL_RE = new RegExp("[.*+?^\\x24{}()|[\\]\\\\]", "g");
export function escapeRegExp(term) {
  return String(term).replace(SPECIAL_RE, "\\$&");
}

// ---------------------------------------------------------------- config
/** Strict JSON validation with a depth cap. */
export function validateJson(text, { maxDepth = 64 } = {}) {
  try {
    const value = JSON.parse(text);
    let depth = 0;
    const walk = (v, d) => {
      if (d > depth) depth = d;
      if (d > maxDepth) throw new Error("depth exceeds " + maxDepth);
      if (v && typeof v === "object") {
        for (const k of Object.keys(v)) walk(v[k], d + 1);
      }
    };
    walk(value, 0);
    return { ok: true, kind: typeof value, depth };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/**
 * YAML structural smoke check (not a full parser): non-empty, balanced
 * brackets/quotes, reasonable indentation. Reports the limitation honestly.
 * @param {string} text
 * @returns {{ok:boolean, error?:string, note?:string, depth?:number}}
 */
export function validateYamlSmoke(text) {
  const t = String(text || "");
  if (t.trim().length === 0) return { ok: false, error: "empty document" };
  const stack = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  let inSingle = false;
  let inDouble = false;
  let maxIndent = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inSingle) {
      if (ch === "'" && t[i - 1] !== "\\") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\"" && t[i - 1] !== "\\") inDouble = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === "\"") inDouble = true;
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return { ok: false, error: "unbalanced " + ch + " at char " + i };
    } else if (ch === "\n") {
      let indent = 0;
      let j = i + 1;
      while (j < t.length && t[j] === " ") { indent++; j++; }
      if (indent > maxIndent) maxIndent = indent;
    }
  }
  if (inSingle) return { ok: false, error: "unterminated single quote" };
  if (inDouble) return { ok: false, error: "unterminated double quote" };
  if (stack.length > 0) return { ok: false, error: "unclosed " + stack[stack.length - 1] };
  return { ok: true, depth: maxIndent, note: "structural smoke check only — not a full YAML parser" };
}

// ----------------------------------------------------------------- network
/**
 * Probe an HTTP(S) URL. Follows redirects; reports final status/URL/time.
 * @param {Function} fetchImpl
 * @param {string} url
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<{ok:boolean, status?:number, finalUrl?:string, timeMs?:number, error?:string}>}
 */
export async function checkUrl(fetchImpl, url, opts = {}) {
  const { timeoutMs = 20000 } = opts;
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "dsh-plugin-verify" },
    });
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, timeMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), timeMs: Date.now() - started };
  }
}

/**
 * Check an npm package: exists, latest version, dsh.bundle manifest,
 * publish time, description.
 * @param {Function} fetchImpl
 * @param {string} name
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<{ok:boolean, name?:string, exists?:boolean, latest?:string, hasDshBundle?:boolean, publishedAt?:string, description?:string, error?:string}>}
 */
export async function checkNpmPackage(fetchImpl, name, opts = {}) {
  const { timeoutMs = 20000 } = opts;
  try {
    const res = await fetchImpl("https://registry.npmjs.org/" + encodeURIComponent(name), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "dsh-plugin-verify" },
    });
    if (res.status === 404) return { ok: true, exists: false, name };
    if (!res.ok) return { ok: false, error: "registry " + res.status };
    const meta = await res.json();
    const latest = meta["dist-tags"] && meta["dist-tags"].latest;
    const v = latest && meta.versions && meta.versions[latest];
    return {
      ok: true,
      exists: true,
      name: meta.name || name,
      latest,
      hasDshBundle: Boolean(v && v.dsh && v.dsh.bundle),
      publishedAt: meta.time && meta.time[latest],
      description: String(meta.description || "").slice(0, 200),
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/**
 * Check a GitHub repo: exists, default branch, created/pushed dates, topics
 * (including the dsh-plugin topic), approximate commit count via Link header.
 * @param {Function} fetchImpl
 * @param {string} fullName - "owner/repo".
 * @param {{token?:string, timeoutMs?:number}} [opts]
 * @returns {Promise<{ok:boolean, fullName?:string, exists?:boolean, defaultBranch?:string, createdAt?:string, ageDays?:number, pushedAt?:string, topics?:string[], hasDshTopic?:boolean, commitCount?:number, description?:string, error?:string}>}
 */
export async function checkGitHubRepo(fetchImpl, fullName, opts = {}) {
  const { token, timeoutMs = 20000 } = opts;
  const headers = { "User-Agent": "dsh-plugin-verify", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = "Bearer " + token;
  try {
    const repo = await fetchImpl("https://api.github.com/repos/" + encodeURIComponent(fullName), { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (repo.status === 404) return { ok: true, exists: false, fullName };
    if (!repo.ok) return { ok: false, error: "github " + repo.status };
    const meta = await repo.json();
    const createdAt = meta.created_at || null;
    const ageDays = createdAt ? Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000)) : null;
    const topics = meta.topics || [];
    const out = {
      ok: true,
      exists: true,
      fullName: meta.full_name || fullName,
      defaultBranch: meta.default_branch,
      createdAt,
      ageDays,
      pushedAt: meta.pushed_at,
      topics,
      hasDshTopic: topics.includes("dsh-plugin"),
      description: String(meta.description || "").slice(0, 200),
    };
    try {
      const commits = await fetchImpl("https://api.github.com/repos/" + encodeURIComponent(fullName) + "/commits?per_page=1", { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (commits.ok) {
        const link = commits.headers.get("link") || "";
        const last = /<([^>]+)>;\s*rel="last"/.exec(link);
        if (last) {
          const page = /[?&]page=(\d+)/.exec(last[1]);
          if (page) out.commitCount = Number(page[1]);
        }
      }
    } catch { /* optional */ }
    return out;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
