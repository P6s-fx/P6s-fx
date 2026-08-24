import { writeFileSync } from "node:fs";

const USER = "P6s-fx";
const OUT = new URL("../metrics.plugin.isocalendar.fullyear.svg", import.meta.url);

const html = await (await fetch(`https://github.com/users/${USER}/contributions`, {
  headers: { "User-Agent": "P6s-fx-isocalendar" },
})).text();

const days = [];
const dayRe = /data-date="(\d{4}-\d{2}-\d{2})" id="(contribution-day-component-\d+-\d+)" data-level="(\d+)"/g;
const tips = new Map();
const tipRe = /for="(contribution-day-component-\d+-\d+)"[^>]*>([^<]+)</g;

for (const match of html.matchAll(tipRe)) {
  const text = match[2];
  const count = text.startsWith("No ") ? 0 : Number(text.match(/^(\d+)/)?.[1] ?? 0);
  tips.set(match[1], count);
}

for (const match of html.matchAll(dayRe)) {
  const [, date, id, level] = match;
  days.push({
    date,
    count: tips.get(id) ?? 0,
    level: Number(level),
    week: Number(id.split("-").at(-1)),
    weekday: Number(id.split("-").at(-2)),
  });
}

days.sort((a, b) => a.date.localeCompare(b.date));
if (!days.length) throw new Error("Could not parse contribution calendar");

const weeks = Math.max(...days.map((d) => d.week)) + 1;
const total = days.reduce((sum, d) => sum + d.count, 0);
const maxDay = Math.max(...days.map((d) => d.count), 1);
const average = total / days.length;

let bestStreak = 0;
let currentStreak = 0;
let run = 0;
for (const day of days) {
  if (day.count > 0) {
    run += 1;
    bestStreak = Math.max(bestStreak, run);
  } else {
    run = 0;
  }
}
for (let i = days.length - 1; i >= 0; i -= 1) {
  if (days[i].count > 0) currentStreak += 1;
  else if (i !== days.length - 1) break;
}

const COLORS = [
  { top: "#2d333b", left: "#22272e", right: "#1c2128" },
  { top: "#0e4429", left: "#0a3620", right: "#052e16" },
  { top: "#006d32", left: "#005a29", right: "#004d22" },
  { top: "#26a641", left: "#1d8a35", right: "#16732c" },
  { top: "#39d353", left: "#26a641", right: "#1a7f37" },
];

const size = 20;
const maxH = 56;
const originX = 108;
const originY = 44;

function project(x, y, z) {
  return [
    originX + (x - y) * (size / 2),
    originY + (x + y) * (size / 4) - z,
  ];
}

function poly(points, fill) {
  return `<polygon points="${points.map((p) => p.join(",")).join(" ")}" fill="${fill}"/>`;
}

function cube(week, weekday, height, colors) {
  const h = Math.max(2, height);
  const t0 = project(week, weekday, h);
  const t1 = project(week + 1, weekday, h);
  const t2 = project(week + 1, weekday + 1, h);
  const t3 = project(week, weekday + 1, h);
  const b1 = project(week + 1, weekday, 0);
  const b2 = project(week + 1, weekday + 1, 0);
  const b3 = project(week, weekday + 1, 0);
  return [
    poly([t3, t2, b2, b3], colors.left),
    poly([t1, t2, b2, b1], colors.right),
    poly([t0, t1, t2, t3], colors.top),
  ].join("");
}

const byCell = new Map(days.map((d) => [`${d.week}-${d.weekday}`, d]));
const cubes = [];
for (let week = 0; week < weeks; week += 1) {
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const day = byCell.get(`${week}-${weekday}`);
    if (!day) continue;
    const height = day.count === 0 ? 2 : 4 + (day.count / maxDay) * maxH;
    cubes.push(cube(week, weekday, height, COLORS[day.level] ?? COLORS[0]));
  }
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="380" viewBox="0 0 900 380" role="img" aria-label="Isometric commit calendar">
  <style>
    .title { font: 600 15px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; }
    .label { font: 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
    .value { font: 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
  </style>
  <text class="title" x="660" y="56">Contributions calendar</text>
  <text class="label" x="660" y="108">Commits streaks</text>
  <text class="value" x="660" y="132">Best streak ${bestStreak} days</text>
  <text class="value" x="660" y="154">Current streak ${currentStreak} days</text>
  <text class="label" x="660" y="202">Commits per day</text>
  <text class="value" x="660" y="226">Highest in a day at ${maxDay}</text>
  <text class="value" x="660" y="248">Average per day at ~${average.toFixed(2)}</text>
  <text class="label" x="660" y="296">${total.toLocaleString()} contributions in the last year</text>
  <g>${cubes.join("")}</g>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`Wrote ${OUT.pathname} (${days.length} days, ${total} contributions)`);
