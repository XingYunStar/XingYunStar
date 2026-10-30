#!/usr/bin/env node
/**
 * 重新生成 assets/languages.svg 与 assets/pull-requests.svg
 *
 * 数据来源：GitHub REST API（只读公开数据）
 * 依赖：无（只用 Node 内置 fetch / fs）
 *
 * 本地运行：  GITHUB_TOKEN=ghp_xxx node scripts/generate-cards.mjs
 * 线上运行：  .github/workflows/update-cards.yml（每天 + 手动触发）
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = process.env.GH_USER || 'XingYunStar';
const TOKEN = process.env.GITHUB_TOKEN || '';
const API = 'https://api.github.com';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/* ---------------------------------------------------------------- helpers */

const C = {
  bg1: '#0d1220', bg2: '#0a0e27', border: '#1e293b',
  amber: '#fde047', orange: '#f59e0b',
  dim: '#7d8590', dimmer: '#6e7681', text: '#e6edf3', sub: '#c9d1d9',
  green: '#3fb950', gray: '#484f58',
};

/** GitHub linguist 常用配色；未知语言走 HSL 兜底 */
const LANG_COLOR = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#4b8bbe',
  HTML: '#e34c26', CSS: '#8b5cf6', SCSS: '#c6538c', Vue: '#41b883',
  Shell: '#89e051', PowerShell: '#012456', Batchfile: '#c1f12e',
  Dockerfile: '#384d54', Makefile: '#427819', Rust: '#dea584',
  Go: '#00add8', Java: '#b07219', 'C++': '#f34b7d', C: '#555555',
  Lua: '#000080', Ruby: '#701516', PHP: '#4f5d95', Kotlin: '#a97bff',
  Swift: '#f05138', Dart: '#00b4ab', 'Jupyter Notebook': '#da5b0b',
};

function langColor(name, i = 0) {
  if (LANG_COLOR[name]) return LANG_COLOR[name];
  return `hsl(${(i * 67 + 20) % 360} 65% 62%)`;
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const n1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => `${n1(v).toFixed(1)}%`;

const humanBytes = (b) => {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
};

/** 淡入动画（SMIL：不支持时会保留静态可见状态，不会变透明） */
const fade = (delay) =>
  `<animate attributeName="opacity" from="0" to="1" begin="${n1(delay)}s" dur="0.55s" fill="freeze"/>`;

/** 宽度生长动画 */
const grow = (to, delay) =>
  `<animate attributeName="width" from="0" to="${n1(to)}" begin="${n1(delay)}s" dur="0.9s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.85 0.25 1"/>`;

const shell = (w, h, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.bg1}"/>
      <stop offset="100%" stop-color="${C.bg2}"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.amber}" stop-opacity="0.85"/>
      <stop offset="45%" stop-color="${C.orange}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${C.bg2}" stop-opacity="0"/>
    </linearGradient>
    <style>.t { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Ubuntu, 'Helvetica Neue', Arial, sans-serif; }</style>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="url(#bg)" stroke="${C.border}"/>
  <rect x="0" y="0" width="${w}" height="2" fill="url(#edge)"/>
  <g class="t">
${body}
  </g>
</svg>
`;

/* ------------------------------------------------------------------- data */

async function gh(path) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function collectLanguages() {
  const repos = await gh(`/users/${USER}/repos?per_page=100&type=owner`);
  const mine = repos.filter((r) => !r.fork && !r.archived);

  const bytes = new Map();
  let withCode = 0;
  for (const repo of mine) {
    const langs = await gh(`/repos/${USER}/${repo.name}/languages`);
    const entries = Object.entries(langs);
    if (!entries.length) continue;
    withCode++;
    for (const [name, size] of entries) {
      bytes.set(name, (bytes.get(name) || 0) + size);
    }
  }

  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  if (!total) return { items: [], total: 0, repos: 0, withCode };

  const sorted = [...bytes.entries()]
    .map(([name, size]) => ({ name, size, pct: (size / total) * 100 }))
    .sort((a, b) => b.size - a.size);

  // 前 5 名单独展示，其余合并为 Other（超过 6 项时）
  const items =
    sorted.length > 6
      ? [
          ...sorted.slice(0, 5),
          {
            name: 'Other',
            size: sorted.slice(5).reduce((a, b) => a + b.size, 0),
            pct: sorted.slice(5).reduce((a, b) => a + b.pct, 0),
          },
        ]
      : sorted;

  return { items, total, repos: mine.length, withCode };
}

async function collectPRs() {
  const search = await gh(
    `/search/issues?q=${encodeURIComponent(`author:${USER} is:pr`)}&per_page=100&sort=created&order=desc`,
  );

  const prs = search.items.map((it) => ({
    title: it.title,
    num: it.number,
    repo: it.repository_url.replace(`${API}/repos/`, ''),
    state: it.pull_request?.merged_at ? 'merged' : 'closed',
  }));

  // OPEN 状态单独标出来（search 返回的 state=open）
  for (const [i, it] of search.items.entries()) {
    if (it.state === 'open') prs[i].state = 'open';
  }

  const count = { merged: 0, open: 0, closed: 0 };
  for (const p of prs) count[p.state]++;

  const byRepo = new Map();
  for (const p of prs) {
    const b = byRepo.get(p.repo) || { name: p.repo, merged: 0, open: 0, closed: 0, items: [] };
    b[p.state]++;
    b.items.push(p);
    byRepo.set(p.repo, b);
  }

  const repos = [...byRepo.values()].sort(
    (a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name),
  );

  return { total: prs.length, count, repos };
}

/* ---------------------------------------------------------------- renders */

function renderLanguages({ items, total, withCode }) {
  const W = 880;
  const rows = Math.max(1, Math.ceil(items.length / 2));
  const H = 104 + rows * 58 + 38;
  const BAR_X = 32;
  const BAR_W = 816;
  const BAR_MAX = 350;

  const label = items.map((i) => `${i.name} ${pct(i.pct)}`).join(', ');
  const aria = `Language statistics: ${label}`;

  // 顶部堆叠条
  let x = BAR_X;
  const segments = items
    .map((it, i) => {
      const w = (it.pct / 100) * BAR_W;
      const seg = `<rect x="${n1(x)}" y="70" width="${n1(w)}" height="14" fill="${langColor(it.name, i)}">${fade(0.15 + i * 0.11)}</rect>`;
      x += w;
      return seg;
    })
    .join('\n      ');

  // 图例（两列，行优先）
  const legend = items
    .map((it, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = col === 0 ? 38 : 462;
      const tx = col === 0 ? 54 : 478;
      const ax = col === 0 ? 404 : 828;
      const y = 142 + row * 58;
      const color = langColor(it.name, i);
      const barW = (it.pct / 100) * BAR_MAX;
      return `    <g>
      ${fade(0.3 + i * 0.09)}
      <circle cx="${cx}" cy="${y - 5}" r="6" fill="${color}"/>
      <text x="${tx}" y="${y}" font-size="13.5" fill="${C.text}" font-weight="600">${esc(it.name)}</text>
      <text x="${ax}" y="${y}" font-size="13" fill="${color}" text-anchor="end" font-weight="600">${pct(it.pct)}</text>
      <rect x="${tx}" y="${y + 10}" width="${n1(barW)}" height="5" rx="2.5" fill="${color}" opacity="0.88">${grow(barW, 0.35 + i * 0.09)}</rect>
    </g>`;
    })
    .join('\n');

  const body = `    <g>
      ${fade(0.05)}
      <text x="32" y="44" font-size="12.5" letter-spacing="3.2" fill="${C.dim}" font-weight="600">LANGUAGES</text>
      <text x="848" y="44" font-size="11.5" fill="${C.dimmer}" text-anchor="end">${withCode} repos with code · ${humanBytes(total)}</text>
    </g>

    <rect x="${BAR_X}" y="70" width="${BAR_W}" height="14" rx="7" fill="#161b22"/>
    <g clip-path="url(#barclip)">
      ${segments}
    </g>

    <line x1="32" y1="104" x2="848" y2="104" stroke="${C.border}" stroke-width="1"/>

${legend}`;

  // 顶部条的圆角裁剪
  const clip = `<clipPath id="barclip"><rect x="${BAR_X}" y="70" width="${BAR_W}" height="14" rx="7"/></clipPath>`;
  return shell(W, H, aria, body).replace('<defs>', `<defs>\n    ${clip}`);
}

function renderPRs({ total, count, repos }) {
  const W = 880;
  const blocks = repos.slice(0, 2);
  const rowsPerBlock = blocks.length > 1 ? 2 : 3;
  const blockH = 94;
  const top = 190;
  const lastY = top + (blocks.length - 1) * blockH + (rowsPerBlock - 1) * 24;
  const H = lastY + 30;

  const mergedPct = total ? (count.merged / total) * 100 : 0;
  const openPct = total ? (count.open / total) * 100 : 0;

  const aria = `Pull requests: ${count.merged} merged, ${count.open} open, ${count.closed} closed`;

  const stateMark = { merged: ['✓', C.green], open: ['◇', C.orange], closed: ['✕', C.dimmer] };
  const stateText = { merged: C.sub, open: C.sub, closed: '#8b93a7' };

  let body = `    <g>
      ${fade(0.05)}
      <text x="32" y="44" font-size="12.5" letter-spacing="3.2" fill="${C.dim}" font-weight="600">PULL REQUESTS</text>`;
  if (count.open > 0) {
    body += `
      <circle cx="754" cy="40" r="4" fill="${C.orange}"><animate attributeName="opacity" values="0.3;1;0.3" dur="2.2s" repeatCount="indefinite"/></circle>
      <text x="812" y="44" font-size="12" letter-spacing="1.6" fill="${C.orange}" text-anchor="end" font-weight="600">${count.open} OPEN</text>`;
  }
  body += `
    </g>

    <g>
      ${fade(0.2)}
      <text x="32" y="112" font-size="36" font-weight="700" fill="${C.green}">${count.merged}</text>
      <text x="32" y="134" font-size="10.5" letter-spacing="2.2" fill="${C.dim}" font-weight="600">MERGED</text>
    </g>
    <g>
      ${fade(0.3)}
      <text x="152" y="112" font-size="36" font-weight="700" fill="${C.orange}">${count.open}</text>
      <text x="152" y="134" font-size="10.5" letter-spacing="2.2" fill="${C.dim}" font-weight="600">OPEN</text>
    </g>
    <g>
      ${fade(0.4)}
      <text x="248" y="112" font-size="36" font-weight="700" fill="${C.dimmer}">${count.closed}</text>
      <text x="248" y="134" font-size="10.5" letter-spacing="2.2" fill="${C.dim}" font-weight="600">CLOSED</text>
    </g>

    <g>
      ${fade(0.4)}
      <text x="848" y="96" font-size="11" fill="${C.dimmer}" text-anchor="end">${total} total</text>
      <rect x="536" y="106" width="312" height="9" rx="4.5" fill="${C.gray}"/>
      <rect x="536" y="106" width="${n1((mergedPct / 100) * 312)}" height="9" rx="4.5" fill="${C.green}"/>
      <rect x="${n1(536 + (mergedPct / 100) * 312)}" y="106" width="${n1((openPct / 100) * 312)}" height="9" rx="4.5" fill="${C.orange}"/>
      <text x="848" y="134" font-size="11" fill="${C.dimmer}" text-anchor="end">${esc(blocks.map((b) => b.name.split('/')[0]).join(' · '))}</text>
    </g>

    <line x1="32" y1="160" x2="848" y2="160" stroke="${C.border}" stroke-width="1"/>`;

  blocks.forEach((repo, bi) => {
    const y = top + bi * blockH;
    const parts = [
      repo.merged && `${repo.merged} merged`,
      repo.open && `${repo.open} open`,
      repo.closed && `${repo.closed} closed`,
    ].filter(Boolean).join(' · ');

    body += `
    <g>
      ${fade(0.5 + bi * 0.12)}
      <text x="32" y="${y}" font-size="14" font-weight="600" fill="${C.text}">${esc(cut(repo.name, 46))}</text>
      <text x="848" y="${y}" font-size="11.5" fill="${C.dimmer}" text-anchor="end">${esc(parts)}</text>
    </g>`;

    repo.items.slice(0, rowsPerBlock).forEach((pr, ii) => {
      const yy = y + 26 + ii * 24;
      const [mark, color] = stateMark[pr.state];
      const titleColor = stateText[pr.state];
      body += `
    <g>
      ${fade(0.55 + bi * 0.12 + ii * 0.06)}
      <text x="32" y="${yy}" font-size="13" fill="${color}">${mark}</text>
      <text x="52" y="${yy}" font-size="12.5" fill="${titleColor}">${esc(cut(pr.title, 78))}</text>
      <text x="848" y="${yy}" font-size="11.5" fill="${C.dimmer}" text-anchor="end">#${pr.num}</text>
    </g>`;
    });
  });

  return shell(W, H, aria, body);
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log('→ 拉取语言数据…');
  const langs = await collectLanguages();
  console.log(`   ${langs.items.length} 种语言 · ${langs.withCode} 个有代码的仓库 · ${humanBytes(langs.total)}`);

  console.log('→ 拉取 PR 数据…');
  const prs = await collectPRs();
  console.log(`   ${prs.total} 个 PR（merged ${prs.count.merged} / open ${prs.count.open} / closed ${prs.count.closed}）`);

  await writeFile(join(OUT, 'languages.svg'), renderLanguages(langs), 'utf8');
  await writeFile(join(OUT, 'pull-requests.svg'), renderPRs(prs), 'utf8');

  console.log('✓ 已写入 assets/languages.svg, assets/pull-requests.svg');
}

main().catch((err) => {
  console.error('✗ 生成失败:', err.message);
  process.exit(1);
});
