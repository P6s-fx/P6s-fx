import { writeFileSync } from "node:fs";

const USER = "P6s-fx";
const OUT = new URL("../metrics.plugin.languages.svg", import.meta.url);
const LIMIT = 8;
const RECENT_DAYS = 90;
const IGNORE = new Set([
  "html", "css", "less", "scss", "dockerfile", "makefile", "cmake",
  "shell", "batchfile", "powershell", "tex", "qmake", "lex", "gnuplot",
  "procfile",
]);

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const headers = {
  "User-Agent": "P6s-fx-languages",
  Accept: "application/vnd.github+json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  Dart: "#00B4AB",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Astro: "#ff5a03",
  PLpgSQL: "#336790",
  SQL: "#e38c00",
  "Jupyter Notebook": "#DA5B0B",
  Other: "#8b949e",
};

function colorFor(name) {
  return COLORS[name] ?? "#8b949e";
}

async function gh(path, extra = {}) {
  const res = await fetch(`https://api.github.com${path}`, { headers: { ...headers, ...extra } });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return res.json();
}

async function authoredCommits() {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await gh(
      `/search/commits?q=${encodeURIComponent(`author:${USER}`)}&per_page=100&page=${page}`,
      { Accept: "application/vnd.github.cloak-preview+json" },
    );
    items.push(...(data.items || []));
    if (!data.items?.length || items.length >= data.total_count) break;
  }
  return items;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(kb >= 10 ? 1 : 2)} kB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatLines(bytes) {
  const lines = Math.max(1, Math.round(bytes / 42));
  if (lines >= 1000) return `${(lines / 1000).toFixed(2).replace(/\.00$/, "")}k lines`;
  return `${lines} lines`;
}

function formatPct(value) {
  const digits = value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.0$/, "")}%`;
}

function rank(totals) {
  const entries = Object.entries(totals)
    .filter(([name, bytes]) => bytes > 0 && !IGNORE.has(name.toLowerCase()))
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + n, 0) || 1;
  const top = entries.slice(0, LIMIT).map(([name, bytes]) => ({
    name,
    bytes,
    color: colorFor(name),
    percent: (bytes / total) * 100,
  }));
  const restBytes = entries.slice(LIMIT).reduce((sum, [, n]) => sum + n, 0);
  if (restBytes > 0) {
    top.push({
      name: "Other",
      bytes: restBytes,
      color: colorFor("Other"),
      percent: (restBytes / total) * 100,
    });
  }
  const shown = top.reduce((sum, l) => sum + l.bytes, 0) || 1;
  return top.map((l) => ({ ...l, percent: (l.bytes / shown) * 100 }));
}

function bar(langs, x, y, width, id) {
  const segments = [];
  let offset = 0;
  for (const [i, lang] of langs.entries()) {
    const w = Number((i === langs.length - 1
      ? Math.max(width - offset, 0)
      : Math.max((lang.percent / 100) * width, 1.5)).toFixed(2));
    segments.push(`<rect x="${(x + offset).toFixed(2)}" y="${y}" width="${w}" height="8" fill="${lang.color}"/>`);
    offset += w;
  }
  return {
    clip: `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${width}" height="8" rx="4"/></clipPath>`,
    body: `<g clip-path="url(#${id})">${segments.join("")}</g>`,
  };
}

function list(langs, x, y, { details = "full" } = {}) {
  const colGap = 430;
  return langs.map((lang, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = x + col * colGap;
    const ly = y + row * 38;
    const meta = details === "full"
      ? `${formatLines(lang.bytes)} · ${formatBytes(lang.bytes)} · ${formatPct(lang.percent)}`
      : formatPct(lang.percent);
    return `<circle cx="${lx}" cy="${ly}" r="5" fill="${lang.color}"/>
      <text class="name" x="${lx + 14}" y="${ly + 1}">${escapeXml(lang.name)}</text>
      <text class="meta" x="${lx + 14}" y="${ly + 18}">${meta}</text>`;
  }).join("\n");
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (ch) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[ch]));
}

const [owned, commits] = await Promise.all([
  gh(`/users/${USER}/repos?type=owner&per_page=100&sort=updated`),
  authoredCommits(),
]);

const repoSet = new Set();
for (const repo of owned) {
  if (!repo.fork && !repo.archived) repoSet.add(repo.full_name);
}
for (const commit of commits) {
  if (commit.repository?.full_name) repoSet.add(commit.repository.full_name);
}

const most = {};
const recent = {};
let analyzed = 0;
const recentCutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
const recentByRepo = new Map();
for (const commit of commits) {
  const fullName = commit.repository?.full_name;
  const when = Date.parse(commit.commit?.author?.date || commit.commit?.committer?.date || "");
  if (!fullName || Number.isNaN(when) || when < recentCutoff) continue;
  recentByRepo.set(fullName, (recentByRepo.get(fullName) || 0) + 1);
}

for (const fullName of repoSet) {
  let langs;
  try {
    langs = await gh(`/repos/${fullName}/languages`);
  } catch {
    continue;
  }
  const bytes = Object.values(langs).reduce((sum, n) => sum + n, 0);
  if (!bytes) continue;
  analyzed += 1;
  for (const [name, size] of Object.entries(langs)) {
    most[name] = (most[name] || 0) + size;
  }
  const weight = recentByRepo.get(fullName);
  if (weight) {
    for (const [name, size] of Object.entries(langs)) {
      recent[name] = (recent[name] || 0) + (size / bytes) * weight * 1000;
    }
  }
}

const mostLangs = rank(most);
const recentLangs = rank(recent);
const mostTotal = Object.entries(most)
  .filter(([name]) => !IGNORE.has(name.toLowerCase()))
  .reduce((sum, [, n]) => sum + n, 0);
const recentCommits = [...recentByRepo.values()].reduce((sum, n) => sum + n, 0);

const mostRows = Math.max(1, Math.ceil(mostLangs.length / 2));
const recentRows = Math.max(1, Math.ceil(recentLangs.length / 2));
const recentTop = 86 + mostRows * 38 + 16;
const height = recentTop + 78 + recentRows * 38 + 16;
const mostBar = bar(mostLangs, 24, 64, 852, "most-bar");
const recentBar = recentLangs.length ? bar(recentLangs, 24, recentTop + 52, 852, "recent-bar") : null;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" role="img" aria-label="Languages activity">
  <defs>
    ${mostBar.clip}
    ${recentBar ? recentBar.clip : ""}
  </defs>
  <style>
    .title { font: 600 15px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; }
    .sub { font: 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
    .name { font: 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .meta { font: 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
  </style>
  <text class="title" x="24" y="28">Most used languages</text>
  <text class="sub" x="24" y="48">estimation from ${formatBytes(mostTotal)} of code across ${analyzed} repositories</text>
  ${mostBar.body}
  ${list(mostLangs, 28, 98)}
  <text class="title" x="24" y="${recentTop + 16}">Recently used languages</text>
  <text class="sub" x="24" y="${recentTop + 36}">${recentCommits ? `from ${recentCommits} public commits in the last ${RECENT_DAYS} days` : `no public commits in the last ${RECENT_DAYS} days`}</text>
  ${recentBar ? recentBar.body : ""}
  ${recentLangs.length ? list(recentLangs, 28, recentTop + 86, { details: "percent" }) : ""}
</svg>
`;

writeFileSync(OUT, svg);
console.log(`Wrote languages SVG (${mostLangs.map((l) => `${l.name} ${formatPct(l.percent)}`).join(", ")})`);
