#!/usr/bin/env node
// Draws the profile cards in assets/ from GitHub's own public numbers.
//
//   node scripts/profile-stats.mjs
//
// Writes five animated SVGs, all in the same Arch Linux / Konsole look:
//   assets/fetch.svg      neofetch-style card: the static system info below
//                         plus live GitHub numbers
//   assets/activity.svg   last-year heatmap, streaks and headline tiles
//   assets/rhythm.svg     contributions per month, per weekday and per year
//   assets/languages.svg  most used and recently used languages
//   assets/stack.svg      the tech stack, as `pacman -Qe` output
//
// Run by .github/workflows/metrics.yml every six hours and on every push. To
// change what the cards say, edit PROFILE and STACK below; never edit the SVGs.
//
// ⚠ Contribution numbers come from the public calendar page
// (github.com/users/<user>/contributions), which counts private work when
// "Private contributions" is switched on in the profile settings. The REST API
// only sees public repositories, which is why pull request and issue counts
// are left off: they would all read 0.
//
// Token: GITHUB_TOKEN or GH_TOKEN if set, only to raise the API rate limit (a
// personal token also lets private repositories into the language totals).
// Without one the script still runs on public data.

import { mkdirSync, writeFileSync } from "node:fs";

const USER = "P6s-fx";
const OUT = new URL("../assets/", import.meta.url);

// ---- what the cards say -----------------------------------------------------

const PROFILE = {
  host: "p6s@archlinux",
  system: [
    ["OS", "Arch Linux x86_64 · Windows 11 Pro"],
    ["Host", "ASUS TUF Gaming F17 · Dell Inspiron 15-3567"],
    ["Kernel", "6.9.1-arch1-1"],
    ["Shell", "bash 5.3.3"],
    ["DE", "Plasma 6.4.4 (KWin)"],
    ["Terminal", "Konsole · Nerd Font"],
    ["CPU", "Intel i5-12500H · Intel i3-6006U"],
    ["GPU", "RTX 3050 Mobile · Radeon R5 M330"],
    ["Editor", "VS Code · Cursor · Windsurf"],
  ],
  work: "Tassos Consultancy · Ahmedabad, IN",
};

const STACK = [
  ["lang", ["TypeScript", "JavaScript", "Python", "Dart", "C++", "SQL", "Bash"]],
  ["frontend", ["Next.js", "React", "Tailwind CSS", "Astro", "Recharts", "visx", "Leaflet"]],
  ["mobile", ["Flutter", "Android"]],
  ["backend", ["Node.js", "NestJS", "Express", "Prisma", "Django", "Flask", "REST · JWT"]],
  ["data", ["PostgreSQL", "MongoDB", "MySQL", "Redis"]],
  ["cloud", ["Docker", "GitHub Actions", "AWS S3", "Firebase", "CI/CD"]],
  ["ai", ["LLM integrations", "Image processing", "AI / ML (learning)"]],
  ["tools", ["Arch Linux", "KDE Plasma", "Git", "VS Code", "Cursor", "Claude Code"]],
];

// ---- theme ------------------------------------------------------------------

const C = {
  bg: "#0b1016",
  bar: "#111923",
  panel: "#131c27",
  line: "#1f2d3c",
  arch: "#1793d1",
  sky: "#7fd0ff",
  ink: "#dbe7f3",
  soft: "#9fb0c2",
  mute: "#5f7184",
  green: "#6fd08c",
  heat: ["#15202c", "#0c3b58", "#0f5f8f", "#1793d1", "#7fd0ff"],
};
// The Arch Linux logo on a 100 × 100 box.
const ARCH_LOGO = `<path d="M50 2C45.6 12.9 42.9 20 38 30.4c3 3.2 6.7 6.9 12.7 11.1-6.5-2.7-10.9-5.4-14.2-8.2C30.2 46.5 20.3 65.3 0 100c15.9-9.2 28.3-14.9 39.8-17.1-.5-2.1-.8-4.4-.8-6.8l.02-.5c.3-10.4 5.7-18.3 12.1-17.8 6.4.5 11.4 9.4 11.1 19.8-.05 2-.3 3.9-.7 5.7C72.9 85.5 85 91.1 100 100c-2.9-5.4-5.6-10.3-8.2-14.9-4-3.1-8.2-7.2-16.7-11.6 5.8 1.5 10 3.3 13.3 5.2C62.9 30.4 60.3 22.5 50 2z"/>`;
const MONO = `'JetBrains Mono','Fira Code','Cascadia Code',Consolas,'DejaVu Sans Mono','Liberation Mono',monospace`;
const W = 900;
const PAD = 24;

const LANG_COLORS = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", "C++": "#f34b7d",
  C: "#555555", "C#": "#178600", Java: "#b07219", Go: "#00ADD8", Rust: "#dea584",
  PHP: "#4F5D95", Kotlin: "#A97BFF", Swift: "#F05138", Dart: "#00B4AB", Vue: "#41b883",
  Svelte: "#ff3e00", Astro: "#ff5a03", PLpgSQL: "#336790", SQL: "#e38c00",
  "Jupyter Notebook": "#DA5B0B", Shell: "#89e051", Other: "#8b949e",
};
const LANG_IGNORE = new Set([
  "html", "css", "less", "scss", "dockerfile", "makefile", "cmake", "shell", "batchfile",
  "powershell", "tex", "qmake", "lex", "gnuplot", "procfile",
]);

const NUMBER = new Intl.NumberFormat("en-GB");
const LONG = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---- fetch ------------------------------------------------------------------

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const user = await api(`users/${USER}`);
const createdYear = Number(user.created_at.slice(0, 4));
const thisYear = new Date().getUTCFullYear();

const days = await calendar();
const years = [];
for (let y = createdYear; y <= thisYear; y++) {
  const d = await calendar(`from=${y}-01-01&to=${y}-12-31`);
  years.push({ year: y, n: d.reduce((s, x) => s + x.count, 0) });
}
const repos = (await pagesOf(`users/${USER}/repos?type=owner`)).filter((r) => !r.fork);
const langs = await languages(repos);

// ---- shape ------------------------------------------------------------------

const today = days.at(-1).date;
const lastYear = sum(days.map((d) => d.count));
const allTime = sum(years.map((y) => y.n));
const active = days.filter((d) => d.count > 0).length;
const best = days.reduce((a, b) => (b.count > a.count ? b : a));

let longest = 0;
let run = 0;
for (const d of days) {
  run = d.count > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
}
// Today still counts as part of the streak until it is over.
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].count > 0) current++;
  else if (i !== days.length - 1) break;
}

const months = [];
for (const d of days) {
  const key = d.date.slice(0, 7);
  if (months.at(-1)?.key !== key) months.push({ key, n: 0 });
  months.at(-1).n += d.count;
}
const lastMonths = months.slice(-12);
const weekdays = WEEKDAYS.map((name, i) => ({ name, n: sum(days.filter((d) => d.weekday === i).map((d) => d.count)) }));
const stars = sum(repos.map((r) => r.stargazers_count));
const since = new Date(user.created_at);

// ---- write ------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const cards = {
  "fetch.svg": fetchSvg(),
  "activity.svg": activitySvg(),
  "rhythm.svg": rhythmSvg(),
  "languages.svg": languagesSvg(),
  "stack.svg": stackSvg(),
};
for (const [file, svg] of Object.entries(cards)) writeFileSync(new URL(file, OUT), svg);

console.log(`${USER}: ${number(lastYear)} contributions last year, ${number(allTime)} all time, streak ${current} (best ${longest}).`);
console.log(`Languages: ${langs.most.map((l) => `${l.name} ${pct(l.percent)}`).join(", ")}`);
console.log(`Wrote ${Object.keys(cards).map((f) => `assets/${f}`).join(", ")}.`);

// ---- cards ------------------------------------------------------------------

function fetchSvg() {
  const ART = [
    "                   -`",
    "                  .o+`",
    "                 `ooo/",
    "                `+oooo:",
    "               `+oooooo:",
    "               -+oooooo+:",
    "             `/:-:++oooo+:",
    "            `/++++/+++++++:",
    "           `/++++++++++++++:",
    "          `/+++ooooooooooooo/`",
    "         ./ooosssso++osssssso+`",
    "        .oossssso-````/ossssss+`",
    "       -osssssso.      :ssssssso.",
    "      :osssssss/        osssso+++.",
    "     /ossssssss/        +ssssooo/-",
    "   `/ossssso+/:-        -:/+osssso+-",
    "  `+sso+:-`                 `.-/+oso:",
    " `++:.                           `-/+/",
    " .`                                 `/",
  ];
  const top = 104;
  const lh = 16;
  const art = ART.map((l, i) => `<text x="${PAD}" y="${top + i * lh}" class="art f" style="animation-delay:${(0.9 + i * 0.03).toFixed(2)}s">${esc(l)}</text>`).join("\n  ");

  const top1 = langs.most[0];
  const info = [
    ...PROFILE.system,
    ["Uptime", `${age(since)} (on GitHub since ${MONTH.format(since)} ${since.getUTCFullYear()})`],
    ["Packages", `${user.public_repos} (public repos) · ${stars} ★ · ${user.followers} followers`],
    ["Commits", `${number(lastYear)} last year · ${number(allTime)} all time`],
    ["Streak", `${current} ${plural(current, "day")} (best ${longest}) · ${active}/${days.length} days active`],
    ["Top lang", top1 ? `${top1.name} ${pct(top1.percent)}${langs.most[1] ? ` · ${langs.most[1].name} ${pct(langs.most[1].percent)}` : ""}` : "—"],
    ["Work", PROFILE.work],
  ];
  const x = 340;
  const ih = 17;
  const rows = [
    `<text x="${x}" y="${top}" class="f" style="animation-delay:1s"><tspan class="hl b">${esc(PROFILE.host.split("@")[0])}</tspan><tspan class="ink">@</tspan><tspan class="hl b">${esc(PROFILE.host.split("@")[1])}</tspan></text>`,
    `<text x="${x}" y="${top + ih}" class="ink f" style="animation-delay:1.04s">${"-".repeat(PROFILE.host.length)}</text>`,
    ...info.map(([k, v], i) => {
      const y = top + (i + 2) * ih;
      const value = clip(v, (W - PAD - x) / 7.8 - k.length - 2);
      return `<text x="${x}" y="${y}" class="f" style="animation-delay:${(1.08 + i * 0.05).toFixed(2)}s"><tspan class="hl b">${esc(k)}</tspan><tspan class="ink">: ${esc(value)}</tspan></text>`;
    }),
  ].join("\n  ");

  const blocksY = top + (info.length + 2) * ih + 6;
  const palette = ["#1d2631", "#e05561", "#6fd08c", "#e6c07b", "#1793d1", "#c678dd", "#56b6c2", "#dbe7f3"];
  const blocks = palette
    .map((c, i) => `<rect x="${x + i * 26}" y="${blocksY}" width="24" height="14" fill="${c}" class="f" style="animation-delay:${(1.9 + i * 0.05).toFixed(2)}s"/>`)
    .join("");
  const H = Math.max(top + ART.length * lh, blocksY + 14) + 26;

  return frame(H, "p6s@archlinux: ~ — Konsole", "fastfetch", `
  <defs>
    <linearGradient id="artfill" x1="0" y1="${top - 12}" x2="0" y2="${top + ART.length * lh}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.sky}"/>
      <stop offset="1" stop-color="${C.arch}"/>
    </linearGradient>
  </defs>
  ${art}
  ${rows}
  ${blocks}`);
}

function activitySvg() {
  const tiles = [
    [number(lastYear), "last-year total"],
    [`${current}d`, `current streak`],
    [`${longest}d`, "longest streak"],
    [`${active}`, `active days of ${days.length}`],
    [number(best.count), `best day · ${SHORT.format(time(best.date))}`],
  ];
  const tileY = 90;
  const gap = 12;
  const tileW = (W - PAD * 2 - gap * (tiles.length - 1)) / tiles.length;
  const tileSvg = tiles
    .map(([v, label], i) => {
      const x = PAD + i * (tileW + gap);
      const d = (0.9 + i * 0.08).toFixed(2);
      return `<g class="f" style="animation-delay:${d}s">
    <rect x="${px(x)}" y="${tileY}" width="${px(tileW)}" height="64" rx="8" fill="${C.panel}" stroke="${C.line}"/>
    <rect x="${px(x)}" y="${tileY + 12}" width="3" height="40" rx="1.5" fill="${C.arch}"/>
    <text x="${px(x + 16)}" y="${tileY + 31}" class="big">${esc(v)}</text>
    <text x="${px(x + 16)}" y="${tileY + 50}" class="cap">${esc(clip(label, (tileW - 24) / 6.6))}</text>
  </g>`;
    })
    .join("\n  ");

  // The heatmap: one column per week, Sunday on top, as on GitHub.
  const cell = 11;
  const step = 14;
  const weeks = Math.max(...days.map((d) => d.week)) + 1;
  const labelW = 34;
  const gridX = Math.round((W - (labelW + weeks * step - 3)) / 2) + labelW;
  const gridY = 196;
  const cells = days
    .map((d) => {
      const x = gridX + d.week * step;
      const y = gridY + d.weekday * step;
      const tip = `${d.count} on ${LONG.format(time(d.date))}`;
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${C.heat[d.level]}" class="pop" style="animation-delay:${(1.3 + d.week * 0.018).toFixed(3)}s"><title>${tip}</title></rect>`;
    })
    .join("");
  let lastLabel = -9;
  const monthLabels = [];
  for (let w = 0; w < weeks; w++) {
    const first = days.find((d) => d.week === w);
    const prev = days.find((d) => d.week === w - 1);
    if (!first || (prev && prev.date.slice(0, 7) === first.date.slice(0, 7)) || w - lastLabel < 4) continue;
    if (w === 0 && first.date.slice(8) > "20") continue;
    lastLabel = w;
    monthLabels.push(`<text x="${gridX + w * step}" y="${gridY - 8}" class="cap">${MONTH.format(time(first.date))}</text>`);
  }
  const dayLabels = [1, 3, 5].map((i) => `<text x="${gridX - 10}" y="${gridY + i * step + 9}" class="cap" text-anchor="end">${WEEKDAYS[i]}</text>`).join("");

  const footY = gridY + 7 * step + 22;
  const legendX = W - PAD - 5 * 14 - 34;
  const legend = [
    `<text x="${legendX - 8}" y="${footY}" class="cap" text-anchor="end">less</text>`,
    ...C.heat.map((c, i) => `<rect x="${legendX + i * 14}" y="${footY - 10}" width="11" height="11" rx="2.5" fill="${c}"/>`),
    `<text x="${legendX + 5 * 14 + 4}" y="${footY}" class="cap">more</text>`,
  ].join("");
  const avg = lastYear / Math.max(active, 1);
  const H = footY + 22;

  return frame(H, "git log --since='1 year ago'", `gh contributions --user ${USER} --last-year`, `
  ${tileSvg}
  ${monthLabels.join("")}
  ${dayLabels}
  ${cells}
  <text x="${PAD}" y="${footY}" class="cap"><tspan class="hl">❯</tspan> ${esc(`${avg.toFixed(1)} per active day · ${number(years.at(-1).n)} in ${years.at(-1).year} so far · updated ${LONG.format(time(today))}`)}</text>
  ${legend}`);
}

function rhythmSvg() {
  // Per month: the last twelve months, vertical bars.
  const titleY = 100;
  const mx = PAD;
  const mw = 500;
  const base = 262;
  const tall = 120;
  const slot = mw / lastMonths.length;
  const bw = Math.min(28, slot - 10);
  const mPeak = Math.max(...lastMonths.map((m) => m.n), 1);
  const bestMonth = lastMonths.reduce((a, b) => (b.n > a.n ? b : a));
  const monthBars = lastMonths
    .map((m, i) => {
      const h = m.n ? Math.max(3, Math.round((m.n / mPeak) * tall)) : 0;
      const x = mx + i * slot + (slot - bw) / 2;
      const cx = px(x + bw / 2);
      const d = (1 + i * 0.06).toFixed(2);
      const fill = m === bestMonth ? "url(#barhot)" : "url(#bar)";
      return [
        h ? `<rect x="${px(x)}" y="${base - h}" width="${px(bw)}" height="${h}" rx="3" fill="${fill}" class="grow" style="animation-delay:${d}s"/>` : "",
        `<text x="${cx}" y="${base - h - 6}" class="val f" text-anchor="middle" style="animation-delay:${(Number(d) + 0.5).toFixed(2)}s">${m.n ? compact(m.n) : ""}</text>`,
        `<text x="${cx}" y="${base + 17}" class="cap" text-anchor="middle">${MONTH.format(time(`${m.key}-01`))}</text>`,
      ].join("");
    })
    .join("\n  ");

  // Per weekday: horizontal bars.
  const wx = 568;
  const barX = wx + 40;
  const barMax = W - PAD - barX - 44;
  const wPeak = Math.max(...weekdays.map((w) => w.n), 1);
  const topDay = weekdays.reduce((a, b) => (b.n > a.n ? b : a));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const weekBars = order
    .map((idx, i) => {
      const w = weekdays[idx];
      const y = titleY + 26 + i * 20;
      const len = w.n ? Math.max(3, Math.round((w.n / wPeak) * barMax)) : 0;
      return [
        `<text x="${wx}" y="${y + 9}" class="cap">${w.name}</text>`,
        `<rect x="${barX}" y="${y}" width="${barMax}" height="11" rx="3" fill="${C.panel}"/>`,
        len ? `<rect x="${barX}" y="${y}" width="${len}" height="11" rx="3" fill="${w === topDay ? C.sky : C.arch}" class="wide" style="animation-delay:${(1.1 + i * 0.07).toFixed(2)}s"/>` : "",
        `<text x="${W - PAD}" y="${y + 9}" class="val" text-anchor="end">${compact(w.n)}</text>`,
      ].join("");
    })
    .join("\n  ");

  // Per year: since the account was opened.
  const yTitle = base + 56;
  const yx = PAD + 44;
  const yMax = W - PAD - yx - 60;
  const yPeak = Math.max(...years.map((y) => y.n), 1);
  const yearBars = years
    .map((y, i) => {
      const top = yTitle + 18 + i * 22;
      const len = y.n ? Math.max(3, Math.round((y.n / yPeak) * yMax)) : 0;
      return [
        `<text x="${PAD}" y="${top + 10}" class="cap">${y.year}</text>`,
        `<rect x="${yx}" y="${top}" width="${yMax}" height="12" rx="3" fill="${C.panel}"/>`,
        len ? `<rect x="${yx}" y="${top}" width="${len}" height="12" rx="3" fill="url(#hbar)" class="wide" style="animation-delay:${(1.6 + i * 0.1).toFixed(2)}s"/>` : "",
        `<text x="${W - PAD}" y="${top + 10}" class="val" text-anchor="end">${number(y.n)}</text>`,
      ].join("");
    })
    .join("\n  ");
  const H = yTitle + 18 + years.length * 22 + 14;

  return frame(H, "gh stats --rhythm", `gh stats --rhythm --since ${createdYear}`, `
  <defs>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.arch}"/><stop offset="1" stop-color="#0c4f75"/></linearGradient>
    <linearGradient id="barhot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.sky}"/><stop offset="1" stop-color="${C.arch}"/></linearGradient>
    <linearGradient id="hbar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0c4f75"/><stop offset="1" stop-color="${C.sky}"/></linearGradient>
  </defs>
  <text x="${mx}" y="${titleY}" class="h">per month</text>
  <text x="${mx + mw}" y="${titleY}" class="cap" text-anchor="end">peak ${esc(MONTH.format(time(`${bestMonth.key}-01`)))} · ${number(bestMonth.n)}</text>
  <line x1="${mx}" y1="${base + 0.5}" x2="${mx + mw}" y2="${base + 0.5}" stroke="${C.line}"/>
  ${monthBars}
  <text x="${wx}" y="${titleY}" class="h">per weekday</text>
  <text x="${W - PAD}" y="${titleY}" class="cap" text-anchor="end">busiest: ${topDay.name}</text>
  ${weekBars}
  <line x1="${PAD}" y1="${yTitle - 22}" x2="${W - PAD}" y2="${yTitle - 22}" stroke="${C.line}" stroke-dasharray="2 4"/>
  <text x="${PAD}" y="${yTitle}" class="h">per year</text>
  <text x="${W - PAD}" y="${yTitle}" class="cap" text-anchor="end">${number(allTime)} contributions since ${createdYear}</text>
  ${yearBars}`);
}

function languagesSvg() {
  const sections = [
    { title: "most used", sub: `by bytes of code across ${langs.analyzed} ${plural(langs.analyzed, "repository", "repositories")}`, list: langs.most, id: "m" },
    {
      title: "recently used",
      sub: langs.recentCommits ? `weighted by ${langs.recentCommits} public commits in the last 90 days` : "no public commits in the last 90 days",
      list: langs.recent,
      id: "r",
    },
  ];
  let y = 100;
  const body = [];
  const defs = [];
  let delay = 0.9;
  for (const s of sections) {
    body.push(`<text x="${PAD}" y="${y}" class="h">${s.title}</text>`);
    body.push(`<text x="${W - PAD}" y="${y}" class="cap" text-anchor="end">${esc(s.sub)}</text>`);
    y += 14;
    if (s.list.length) {
      const bw = W - PAD * 2;
      let off = 0;
      const segs = s.list.map((l, i) => {
        const w = i === s.list.length - 1 ? bw - off : Math.max((l.percent / 100) * bw, 2);
        const r = `<rect x="${px(PAD + off)}" y="${y}" width="${px(w)}" height="10" fill="${l.color}"/>`;
        off += w;
        return r;
      });
      defs.push(`<clipPath id="clip-${s.id}"><rect x="${PAD}" y="${y}" width="${bw}" height="10" rx="5"/></clipPath>`);
      body.push(`<g clip-path="url(#clip-${s.id})"><g class="wide" style="animation-delay:${delay}s">${segs.join("")}</g></g>`);
      y += 34;
      const colW = (W - PAD * 2 - 40) / 2;
      s.list.forEach((l, i) => {
        const cx = PAD + (i % 2) * (colW + 40);
        const cy = y + Math.floor(i / 2) * 32;
        const d = (delay + 0.3 + i * 0.05).toFixed(2);
        const meta = s.id === "m" ? `${size(l.bytes)} · ${pct(l.percent)}` : pct(l.percent);
        body.push(`<g class="f" style="animation-delay:${d}s">
    <circle cx="${cx + 5}" cy="${cy - 4}" r="4.5" fill="${l.color}"/>
    <text x="${cx + 16}" y="${cy}" class="ink">${esc(l.name)}</text>
    <text x="${px(cx + colW)}" y="${cy}" class="cap" text-anchor="end">${meta}</text>
    <rect x="${cx + 16}" y="${cy + 7}" width="${px(colW - 16)}" height="3" rx="1.5" fill="${C.panel}"/>
    <rect x="${cx + 16}" y="${cy + 7}" width="${px(Math.max(2, ((colW - 16) * l.percent) / 100))}" height="3" rx="1.5" fill="${l.color}" class="wide" style="animation-delay:${(Number(d) + 0.2).toFixed(2)}s"/>
  </g>`);
      });
      y += Math.ceil(s.list.length / 2) * 32 + 22;
    } else {
      y += 30;
    }
    delay += 0.6;
  }
  return frame(y - 8, "tokei ~/github --sort code", "tokei ~/github --sort code", `
  <defs>${defs.join("")}</defs>
  ${body.join("\n  ")}`);
}

function stackSvg() {
  const labelW = 118;
  const x0 = PAD + labelW;
  const chipH = 24;
  const rowGap = 10;
  let y = 92;
  let n = 0;
  const rows = STACK.map(([group, items]) => {
    const parts = [];
    let x = x0;
    const rowTop = y;
    for (const item of items) {
      const w = Math.round(item.length * 7.8 + 30);
      if (x + w > W - PAD) {
        x = x0;
        y += chipH + 8;
      }
      const d = (0.9 + n++ * 0.035).toFixed(3);
      parts.push(`<g class="f" style="animation-delay:${d}s">
    <rect x="${x}" y="${y}" width="${w}" height="${chipH}" rx="6" fill="${C.panel}" stroke="${C.line}"/>
    <circle cx="${x + 11}" cy="${y + chipH / 2}" r="3" fill="${LANG_COLORS[item] ?? C.arch}"/>
    <text x="${x + 20}" y="${y + 16}" class="ink">${esc(item)}</text>
  </g>`);
      x += w + 8;
    }
    const label = `<text x="${PAD}" y="${rowTop + 16}" class="f" style="animation-delay:${(0.85 + (n - items.length) * 0.035).toFixed(3)}s"><tspan class="mute">[</tspan><tspan class="hl b">${esc(group)}</tspan><tspan class="mute">]</tspan></text>`;
    y += chipH + rowGap;
    return label + parts.join("");
  });
  const total = sum(STACK.map(([, items]) => items.length));
  y += 6;
  return frame(y + 20, "pacman -Qe --groups stack", "pacman -Qe --groups stack", `
  ${rows.join("\n  ")}
  <text x="${PAD}" y="${y + 4}" class="cap f" style="animation-delay:${(0.9 + total * 0.035).toFixed(2)}s"><tspan class="hl">::</tspan> ${total} packages installed across ${STACK.length} groups · always learning more</text>`);
}

// ---- drawing ----------------------------------------------------------------

// A Konsole window: title bar with the Arch logo, a prompt that types itself
// out, then the card's body.
function frame(h, title, command, body) {
  const prompt = `[${PROFILE.host} ~]$ `;
  const typed = prompt.length * 7.8;
  const cmdW = command.length * 7.8;
  const steps = Math.min(command.length, 40);
  const values = Array.from({ length: steps + 1 }, (_, i) => px((cmdW * i) / steps)).join(";");
  return `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-labelledby="t">
  <title id="t">${esc(`${command} — ${USER}'s GitHub profile, updated ${LONG.format(time(today))}`)}</title>
  <style>
    text { font-family: ${MONO}; font-size: 13px; fill: ${C.ink}; white-space: pre; }
    .ink { fill: ${C.ink}; } .soft { fill: ${C.soft}; } .mute { fill: ${C.mute}; }
    .hl { fill: ${C.arch}; } .b { font-weight: 700; } .ok { fill: ${C.green}; }
    .art { fill: url(#artfill); font-size: 13px; font-weight: 700; }
    .cap { font-size: 11px; fill: ${C.soft}; }
    .val { font-size: 10.5px; fill: ${C.soft}; }
    .h { font-size: 12px; font-weight: 700; fill: ${C.sky}; letter-spacing: 1.5px; text-transform: uppercase; }
    .big { font-size: 22px; font-weight: 700; fill: ${C.ink}; }
    .f { animation: fade .5s ease-out both; }
    .pop { animation: pop .35s ease-out both; transform-box: fill-box; transform-origin: center; }
    .grow { animation: grow .8s cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: 50% 100%; }
    .wide { animation: wide .9s cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: 0 50%; }
    .cursor { animation: blink 1.05s steps(1) infinite; }
    @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes pop { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: none; } }
    @keyframes grow { from { transform: scaleY(0); } to { transform: none; } }
    @keyframes wide { from { transform: scaleX(0); } to { transform: none; } }
    @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <defs>
    <radialGradient id="glow" cx="0.08" cy="0" r="0.9">
      <stop offset="0" stop-color="${C.arch}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${C.arch}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#ffffff" fill-opacity="0.018"/></pattern>
    <clipPath id="win"><rect width="${W}" height="${h}" rx="12"/></clipPath>
    <clipPath id="type"><rect x="${px(PAD + typed)}" y="50" width="${px(cmdW + 2)}" height="24"><animate attributeName="width" values="${values}" calcMode="discrete" dur="${(steps * 0.035).toFixed(2)}s" begin="0.2s" fill="freeze"/></rect></clipPath>
  </defs>
  <g clip-path="url(#win)">
    <rect width="${W}" height="${h}" fill="${C.bg}"/>
    <rect width="${W}" height="${h}" fill="url(#glow)"/>
    <rect width="${W}" height="${h}" fill="url(#scan)"/>
    <rect width="${W}" height="34" fill="${C.bar}"/>
    <line x1="0" y1="34.5" x2="${W}" y2="34.5" stroke="${C.line}"/>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="11.5" fill="none" stroke="${C.line}"/>
  <g transform="translate(14 9) scale(0.16)" fill="${C.arch}">${ARCH_LOGO}</g>
  <text x="${W / 2}" y="22" class="cap" text-anchor="middle">${esc(title)}</text>
  <g fill="none" stroke="${C.soft}" stroke-width="1.4" stroke-linecap="round">
    <path d="M${W - 76} 17.5h8"/>
    <path d="M${W - 50} 13.5l4 4 4-4"/>
    <circle cx="${W - 22}" cy="17.5" r="7" fill="${C.arch}" stroke="none"/>
    <path d="M${W - 25} 14.5l6 6M${W - 19} 14.5l-6 6" stroke="${C.bg}"/>
  </g>
  <text x="${PAD}" y="66"><tspan class="mute">[</tspan><tspan class="ok b">${esc(PROFILE.host)}</tspan> <tspan class="hl b">~</tspan><tspan class="mute">]</tspan><tspan class="ink">$ </tspan></text>
  <text x="${px(PAD + typed)}" y="66" clip-path="url(#type)" class="ink">${esc(command)}</text>
  <rect x="${px(PAD + typed + cmdW + 3)}" y="54" width="8" height="15" fill="${C.arch}" class="cursor"/>
  ${body}
</svg>
`;
}

// ---- data -------------------------------------------------------------------

async function calendar(query = "") {
  const url = `https://github.com/users/${USER}/contributions${query ? `?${query}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": `${USER}-profile-stats` } });
  if (!res.ok) fail(`github.com answered ${res.status} for the contribution calendar.`);
  const html = await res.text();
  const counts = new Map();
  for (const m of html.matchAll(/for="(contribution-day-component-\d+-\d+)"[^>]*>([^<]+)</g)) {
    counts.set(m[1], m[2].startsWith("No ") ? 0 : Number(m[2].match(/^([\d,]+)/)?.[1].replace(/,/g, "") ?? 0));
  }
  const out = [];
  for (const m of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})" id="(contribution-day-component-(\d+)-(\d+))" data-level="(\d)"/g)) {
    out.push({ date: m[1], count: counts.get(m[2]) ?? 0, weekday: Number(m[3]), week: Number(m[4]), level: Number(m[5]) });
  }
  if (!out.length) fail("could not read the contribution calendar; GitHub may have changed its markup.");
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function languages(owned) {
  const commits = [];
  for (let page = 1; page <= 5; page++) {
    const data = await api(`search/commits?q=${encodeURIComponent(`author:${USER}`)}&per_page=100&page=${page}&sort=author-date`);
    commits.push(...(data.items ?? []));
    if (!data.items?.length || commits.length >= data.total_count) break;
  }
  const names = new Set(owned.filter((r) => !r.archived).map((r) => r.full_name));
  for (const c of commits) if (c.repository?.full_name) names.add(c.repository.full_name);

  const cutoff = Date.now() - 90 * 86_400_000;
  const recentBy = new Map();
  for (const c of commits) {
    const when = Date.parse(c.commit?.author?.date ?? "");
    const name = c.repository?.full_name;
    if (name && when >= cutoff) recentBy.set(name, (recentBy.get(name) ?? 0) + 1);
  }

  const most = {};
  const recent = {};
  let analyzed = 0;
  for (const name of names) {
    const langs = await api(`repos/${name}/languages`, true);
    const total = sum(Object.values(langs ?? {}));
    if (!total) continue;
    analyzed++;
    const weight = recentBy.get(name) ?? 0;
    for (const [lang, bytes] of Object.entries(langs)) {
      most[lang] = (most[lang] ?? 0) + bytes;
      if (weight) recent[lang] = (recent[lang] ?? 0) + (bytes / total) * weight;
    }
  }
  return { most: rank(most), recent: rank(recent), analyzed, recentCommits: sum([...recentBy.values()]) };
}

function rank(totals, limit = 8) {
  const entries = Object.entries(totals)
    .filter(([name, n]) => n > 0 && !LANG_IGNORE.has(name.toLowerCase()))
    .sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, limit).map(([name, bytes]) => ({ name, bytes }));
  const rest = sum(entries.slice(limit).map(([, n]) => n));
  if (rest) top.push({ name: "Other", bytes: rest });
  const total = sum(top.map((l) => l.bytes)) || 1;
  return top.map((l) => ({ ...l, color: LANG_COLORS[l.name] ?? LANG_COLORS.Other, percent: (l.bytes / total) * 100 }));
}

async function api(path, optional = false) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `${USER}-profile-stats`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    if (optional) return null;
    fail(`GitHub answered ${res.status} for /${path.split("?")[0]}.`);
  }
  return res.json();
}

async function pagesOf(path) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

// ---- small things -----------------------------------------------------------

function age(from) {
  const now = new Date();
  let m = (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + now.getUTCMonth() - from.getUTCMonth();
  if (now.getUTCDate() < from.getUTCDate()) m--;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return [y ? `${y} ${plural(y, "year")}` : "", r ? `${r} ${plural(r, "month")}` : ""].filter(Boolean).join(", ") || "new";
}

function time(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function sum(list) {
  return list.reduce((s, n) => s + n, 0);
}

function number(n) {
  return NUMBER.format(n);
}

function compact(n) {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

function pct(v) {
  return `${v.toFixed(v >= 10 ? 1 : 2).replace(/\.0+$/, "")}%`;
}

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function plural(n, word, many = `${word}s`) {
  return n === 1 ? word : many;
}

function clip(value, chars) {
  const max = Math.floor(chars);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function px(n) {
  return Math.round(n * 10) / 10;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fail(message) {
  console.error(`profile-stats: ${message}`);
  process.exit(1);
}
