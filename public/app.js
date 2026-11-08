// dibaMCP — داشبورد (بدون فریم‌ورک)
const $app = document.getElementById("app");
const state = { providers: [], overview: null, logs: [], logFilter: { ok: "all", provider: "" }, openProv: null, timer: null };

// ---------------------------------------------------------------- utils
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fa = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("fa-IR"));
const rtf = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });
function ago(iso) {
  const s = Math.round((new Date(iso) - Date.now()) / 1000);
  if (Math.abs(s) < 60) return rtf.format(s, "second");
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
function jsonHtml(v) {
  const s = esc(JSON.stringify(v, null, 2) ?? "null");
  return s.replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, (m, str, colon, lit) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (lit) return `<span class="b">${m}</span>`;
    return `<span class="n">${m}</span>`;
  });
}
function toast(msg, isErr = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 3200);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
  }
  toast("کپی شد");
}
async function busy(btn, fn) {
  btn?.classList.add("loading"); if (btn) btn.disabled = true;
  try { return await fn(); } finally { btn?.classList.remove("loading"); if (btn) btn.disabled = false; }
}

class AuthError extends Error {}
async function api(path, opts = {}) {
  const res = await fetch("api/" + path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("auth/")) { boot(); throw new AuthError(); }
  if (!res.ok) throw new Error(data.error || `خطای ${res.status}`);
  return data;
}

const icons = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="6" r="1.8"/><circle cx="19.5" cy="6" r="1.8"/><circle cx="4.5" cy="18" r="1.8"/><circle cx="19.5" cy="18" r="1.8"/><path d="M6 7l3.5 3M18 7l-3.5 3M6 17l3.5-3M18 17l-3.5-3"/></svg>',
  providers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 2h6l1-2h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 12h10"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 4L3 11l7 2 2 7z"/><path d="M10 13l10-9"/></svg>',
  playground: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/></svg>',
  logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
  connect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 15l6-6M10 6l1-1a4.2 4.2 0 0 1 6 6l-1 1M14 18l-1 1a4.2 4.2 0 0 1-6-6l1-1"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
};

const pages = [
  { id: "overview", title: "نمای کلی" },
  { id: "providers", title: "پیام‌رسان‌ها" },
  { id: "inbox", title: "پیام‌های دریافتی" },
  { id: "playground", title: "آزمایش ابزارها" },
  { id: "logs", title: "گزارش فراخوانی‌ها" },
  { id: "connect", title: "اتصال به هوش مصنوعی" },
];

function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  return { page: pages.some((p) => p.id === path) ? path : "overview", q: new URLSearchParams(qs) };
}

function status(p) {
  if (p.ready) return '<span class="pill pill-ok">آماده</span>';
  if (p.enabled) return '<span class="pill pill-warn">نیاز به تنظیم</span>';
  return '<span class="pill pill-off">خاموش</span>';
}

// ---------------------------------------------------------------- auth
function switchboardArt() {
  const nodes = [["#1fb486", 120, 90], ["#f08a24", 400, 80], ["#c026d3", 430, 300], ["#3b82f6", 110, 290]];
  return `<svg viewBox="0 0 540 380" aria-hidden="true">
    ${nodes.map(([c, x, y]) => `<path class="wire live" d="M270 190 Q ${(270 + x) / 2} ${y}, ${x} ${y}"/>`).join("")}
    <circle cx="270" cy="190" r="56" fill="#24327a"/><circle cx="270" cy="190" r="20" fill="#2bb3a3"/>
    ${nodes.map(([c, x, y]) => `<circle cx="${x}" cy="${y}" r="26" fill="${c}"/>`).join("")}
  </svg>`;
}

function renderAuth(needsSetup) {
  $app.innerHTML = `
  <div class="auth">
    <div class="auth-art">${switchboardArt()}</div>
    <div class="auth-form">
      <div class="brand" style="padding:0"><span class="brand-mark"></span><div><b>dibaMCP</b><small>اتصال پیام‌رسان‌های ایرانی به هوش مصنوعی</small></div></div>
      ${needsSetup ? `
        <h1>راه‌اندازی اولیه</h1>
        <p>کد شش‌حرفی‌ای که هنگام اجرای سرور در کنسول چاپ شد را وارد کنید و یک رمز برای داشبورد بسازید.</p>
        <form id="f">
          <div class="field"><label for="code">کد راه‌اندازی</label><input id="code" class="input ltr-input" autocomplete="off" required maxlength="6"></div>
          <div class="field"><label for="pw">رمز داشبورد</label><input id="pw" type="password" class="input" autocomplete="new-password" minlength="8" required><span class="hint">حداقل ۸ کاراکتر</span></div>
          <div class="field"><label for="pw2">تکرار رمز</label><input id="pw2" type="password" class="input" autocomplete="new-password" required></div>
          <div class="form-err" id="err"></div>
          <button class="btn btn-primary" type="submit">ساخت رمز و ورود</button>
        </form>` : `
        <h1>ورود به داشبورد</h1>
        <p>برای مدیریت سرویس‌ها و توکن‌ها وارد شوید.</p>
        <form id="f">
          <div class="field"><label for="pw">رمز داشبورد</label><input id="pw" type="password" class="input" autocomplete="current-password" required autofocus></div>
          <div class="form-err" id="err"></div>
          <button class="btn btn-primary" type="submit">ورود</button>
        </form>`}
    </div>
  </div>`;
  const f = document.getElementById("f");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("err");
    err.textContent = "";
    const pw = f.querySelector("#pw").value;
    try {
      if (needsSetup) {
        if (pw !== f.querySelector("#pw2").value) { err.textContent = "رمز و تکرارش یکی نیستند"; return; }
        await busy(f.querySelector("button"), () => api("auth/setup", { body: { code: f.querySelector("#code").value, password: pw } }));
      } else {
        await busy(f.querySelector("button"), () => api("auth/login", { body: { password: pw } }));
      }
      boot();
    } catch (ex) { err.textContent = ex.message; }
  });
}

// ---------------------------------------------------------------- shell
function renderShell() {
  $app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><span class="brand-mark"></span><div><b>dibaMCP</b><small id="ver"></small></div></div>
      <nav class="nav" aria-label="بخش‌ها">
        ${pages.map((p) => `<a href="#/${p.id}" data-page="${p.id}">${icons[p.id]}<span>${p.title}</span></a>`).join("")}
      </nav>
      <div class="side-foot">
        <button class="btn btn-icon btn-quiet" id="theme" title="تغییر تم" aria-label="تغییر تم">${icons.theme}</button>
        <button class="btn btn-icon btn-quiet" id="logout" title="خروج" aria-label="خروج">${icons.logout}</button>
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  document.getElementById("theme").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dmcp-theme", next); } catch {}
  };
  document.getElementById("logout").onclick = async () => { await api("auth/logout", { body: {} }); boot(); };
}

async function render() {
  clearInterval(state.timer);
  const { page, q } = route();
  document.querySelectorAll(".nav a").forEach((a) => (a.dataset.page === page ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.title = `${pages.find((p) => p.id === page).title} — dibaMCP`;
  const main = document.getElementById("main");
  try {
    await ({ overview: pageOverview, providers: pageProviders, playground: pagePlayground, inbox: pageInbox, logs: pageLogs, connect: pageConnect })[page](main, q);
  } catch (e) {
    if (!(e instanceof AuthError)) main.innerHTML = `<div class="err-box">${esc(e.message)}</div>`;
  }
  main.focus?.();
}

function head(title, desc, actions = "") {
  return `<header class="page-head"><div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ""}</div>${actions}</header>`;
}

// ---------------------------------------------------------------- overview
function hubSvg(providers, activeTools) {
  const W = 560, H = 380, cx = W / 2, cy = H / 2;
  const angles = providers.length === 4 ? [-38, 38, 142, 218] : providers.map((_, i) => (360 / providers.length) * i - 90);
  const nodes = providers.map((p, i) => {
    const a = (angles[i] * Math.PI) / 180;
    return { ...p, x: cx + 205 * Math.cos(a), y: cy + 128 * Math.sin(a) };
  });
  const wires = nodes.map((n) => {
    const mx = (cx + n.x) / 2, my = n.y;
    const d = `M ${cx} ${cy} Q ${mx} ${my} ${n.x} ${n.y}`;
    return n.ready ? `<path class="wire-base live" d="${d}"/><path class="wire live" d="${d}"/>` : `<path class="wire" d="${d}"/>`;
  }).join("");
  const sub = (n) => (n.ready ? `${fa(n.toolCount)} ابزار` : n.enabled ? "نیاز به تنظیم" : "خاموش");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="وضعیت اتصال پیام‌رسان‌ها">
    <defs><linearGradient id="halo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2bb3a3"/><stop offset=".5" stop-color="#e8a33d"/><stop offset="1" stop-color="#2bb3a3" stop-opacity="0"/>
    </linearGradient></defs>
    ${wires}
    <g class="hub">
      <circle class="hub-halo" cx="${cx}" cy="${cy}" r="62" fill="none" stroke="url(#halo)" stroke-width="2" stroke-dasharray="120 60 40 30"/>
      <circle cx="${cx}" cy="${cy}" r="50" fill="var(--lapis-600)"/>
      <circle cx="${cx}" cy="${cy}" r="50" fill="none" stroke="rgba(255,255,255,.12)"/>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="#fff">${fa(activeTools)}</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="11" fill="#c6cdf0">ابزار فعال</text>
    </g>
    ${nodes.map((n) => `
      <g class="node${n.ready ? "" : " off"}"><a href="#/providers?open=${n.id}" aria-label="${esc(n.nameFa)}">
        <circle class="node-ring" cx="${n.x}" cy="${n.y}" r="33"/>
        <g class="disc"><circle cx="${n.x}" cy="${n.y}" r="26" fill="${n.color}"/>
        <text class="glyph" x="${n.x}" y="${n.y + 7}" text-anchor="middle">${esc(n.glyph)}</text></g>
        <text class="label" x="${n.x}" y="${n.y + 54}" text-anchor="middle">${esc(n.nameFa)}</text>
        <text class="sub" x="${n.x}" y="${n.y + 71}" text-anchor="middle">${sub(n)}</text>
      </a></g>`).join("")}
  </svg>`;
}

function callRow(l, expandable = false) {
  return `<div class="call${l.ok ? "" : " fail"}" ${expandable ? `role="button" tabindex="0" data-log="${l.id}"` : ""}>
    <span class="dot" aria-label="${l.ok ? "موفق" : "ناموفق"}"></span>
    <span class="tool">${esc(l.tool)}</span>
    ${l.ok ? `<span class="src">${l.source === "mcp" ? "از طرف مدل" : "از داشبورد"}</span>` : `<span class="err" title="${esc(l.error)}">${esc(l.error)}</span>`}
    <span class="meta">${fa(l.ms)} میلی‌ثانیه</span>
    <span class="meta">${ago(l.time)}</span>
  </div>`;
}

async function pageOverview(main) {
  const o = await api("overview");
  document.getElementById("ver").textContent = `نسخه ${o.version}`;
  const ready = o.providers.filter((p) => p.ready).length;
  main.innerHTML = `
    ${head("نمای کلی", "هر پیام‌رسانی که توکنش ثبت و روشن شده باشد، ابزارهایش به مدل هوش مصنوعی وصل می‌شود.")}
    <section class="board">
      <div class="board-map">${hubSvg(o.providers, o.activeTools)}</div>
      <div class="board-side">
        <div class="metric"><span>پیام‌رسان‌های آماده</span><b>${fa(ready)}<small>از ${fa(o.providers.length)}</small></b></div>
        <div class="metric"><span>فراخوانی‌های امروز</span><b>${fa(o.stats.today)}</b></div>
        <div class="metric"><span>موفقیت امروز</span><b>${o.stats.successRate === null ? "—" : fa(o.stats.successRate) + "٪"}</b></div>
        <div class="metric"><span>میانگین زمان پاسخ</span><b>${o.stats.avgMs === null ? "—" : fa(o.stats.avgMs)}<small>${o.stats.avgMs === null ? "" : "میلی‌ثانیه"}</small></b></div>
        ${ready === 0 ? `<a class="btn btn-primary" href="#/providers">اولین پیام‌رسان را وصل کنید</a>` : `<a class="btn" href="#/connect">اتصال به Claude و ابزارهای دیگر</a>`}
      </div>
    </section>
    <div class="section-title"><h2>دسترسی این سرور به پیام‌رسان‌ها</h2><button class="btn" id="netcheck">بررسی دسترسی</button></div>
    <div class="calls" id="net-out"><div class="empty"><b>هنوز بررسی نشده</b>نشان می‌دهد این سرور (مثلاً سرور خارج از ایران) به API هر پیام‌رسان می‌رسد یا نه.</div></div>
    <div class="section-title"><h2>آخرین فراخوانی‌ها</h2><a href="#/logs">همه‌ی گزارش‌ها</a></div>
    <div class="calls">
      ${o.recent.length ? o.recent.map((l) => callRow(l)).join("") : `<div class="empty"><b>هنوز ابزاری صدا زده نشده</b>از بخش «آزمایش ابزارها» اولین پیام را بفرستید.</div>`}
    </div>`;

  document.getElementById("netcheck").onclick = async (e) => {
    const out = document.getElementById("net-out");
    const r = await busy(e.currentTarget, () => api("netcheck"));
    const via = r.proxy.type === "direct" ? "مستقیم" : `از طریق پراکسی ${r.proxy.type}`;
    out.innerHTML =
      `<div class="call"><span class="dot" style="background:var(--saffron)"></span><span>IP خروجی: ${r.egressIp ? `<span class="ltr mono">${esc(r.egressIp)}</span>` : "نامعلوم"}</span><span class="src">${esc(via)}</span><span></span><span></span></div>` +
      r.results.map((x) => `<div class="call${x.reachable ? "" : " fail"}">
        <span class="dot"></span>
        <span><b>${esc(x.name)}</b> <span class="ltr mono" style="color:var(--text-faint);font-size:12px">${esc(x.url)}</span></span>
        ${x.reachable ? `<span class="src">در دسترس (HTTP ${fa(x.status)})</span>` : `<span class="err" title="${esc(x.error)}">${esc(x.error)}</span>`}
        <span class="meta">${fa(x.ms)} میلی‌ثانیه</span><span></span>
      </div>`).join("");
  };
}

// ---------------------------------------------------------------- providers
function fieldHtml(p, f) {
  const id = `${p.id}-${f.key}`;
  const locked = f.fromEnv;
  const label = `<label for="${id}">${esc(f.label)}${f.required ? '<span class="req" aria-label="الزامی">*</span>' : ""}${locked ? `<span class="env-badge" title="${esc(f.envName)}">از env</span>` : ""}</label>`;
  const hint = locked ? `<span class="hint">مقدار از متغیر <code class="ltr">${esc(f.envName)}</code> خوانده می‌شود.</span>` : f.help ? `<span class="hint">${esc(f.help)}</span>` : "";
  if (f.type === "secret") {
    const ph = f.masked || f.placeholder || "";
    const savedHint = f.masked && !locked ? `<span class="hint">توکن ذخیره شده است. برای عوض کردنش، توکن جدید را بنویسید؛ خالی بماند یعنی بدون تغییر.</span>` : hint;
    return `<div class="field">${label}<div class="input-wrap">
      <input id="${id}" name="${f.key}" type="password" class="input ltr-input" placeholder="${esc(ph)}" autocomplete="off" ${locked ? "disabled" : ""}>
      <button type="button" class="btn btn-icon btn-quiet" data-reveal="${id}" aria-label="نمایش">${icons.eye}</button></div>${savedHint}</div>`;
  }
  const pick = f.key === "defaultChatId" && p.receive?.supported && !locked ? `<span class="hint"><a href="#/inbox?p=${p.id}">انتخاب از پیام‌های دریافتی</a></span>` : "";
  return `<div class="field">${label}<input id="${id}" name="${f.key}" class="input ${f.type === "url" || /id$/i.test(f.key) ? "ltr-input" : ""}" value="${esc(f.value)}" placeholder="${esc(f.placeholder || f.default || "")}" ${locked ? "disabled" : ""}>${hint}${pick}</div>`;
}

function provHtml(p) {
  const open = state.openProv === p.id;
  return `<article class="prov${open ? " open" : ""}${p.ready ? " is-ready" : ""}" data-id="${p.id}">
    <div class="prov-head">
      <div class="disc" style="background:${p.color}">${esc(p.glyph)}</div>
      <div class="prov-title"><b>${esc(p.nameFa)}</b><small class="ltr">${esc(p.name)}</small><p>${esc(p.description)}</p></div>
      ${status(p)}
      <label class="switch" title="روشن/خاموش"><input type="checkbox" data-toggle ${p.enabled ? "checked" : ""} aria-label="روشن کردن ${esc(p.nameFa)}"><span></span></label>
      <button class="btn btn-icon btn-quiet" data-expand aria-expanded="${open}" aria-label="تنظیمات ${esc(p.nameFa)}" style="transform:rotate(${open ? 180 : 0}deg);transition:transform .3s">${icons.chevron}</button>
    </div>
    <div class="prov-body"><div><div class="prov-inner">
      <form class="prov-form" data-form>
        ${p.fields.map((f) => fieldHtml(p, f)).join("")}
        <div class="prov-actions">
          <button class="btn btn-primary" type="submit">ذخیره تنظیمات</button>
          ${p.hasTest ? `<button class="btn" type="button" data-test>تست اتصال</button>` : ""}
          ${p.hasTest ? `<button class="btn" type="button" data-selftest>تست کامل</button>` : ""}
          ${p.fields.some((f) => f.type === "secret" && f.hasValue && !f.fromEnv) ? `<button class="btn btn-quiet btn-danger" type="button" data-clear>حذف توکن</button>` : ""}
        </div>
        <div class="test-out" data-out></div>
      </form>
      <div class="prov-tools">
        <h3>${fa(p.tools.length)} ابزار در اختیار مدل</h3>
        ${p.tools.map((t) => `<div class="tool-line"><a href="#/playground?tool=${t.name}">${esc(t.title)}</a><code>${esc(t.name)}</code></div>`).join("")}
        ${p.docsUrl ? `<p class="note"><a href="${esc(p.docsUrl)}" target="_blank" rel="noopener">مستندات رسمی ${esc(p.nameFa)}</a></p>` : ""}
      </div>
    </div></div></div>
  </article>`;
}

function selfTestHtml(r) {
  const icon = { ok: icons.check, fail: icons.cross, skip: icons.dash };
  const label = { ok: "موفق", fail: "ناموفق", skip: "رد شد" };
  const failed = r.steps.filter((x) => x.status === "fail").length;
  return `<div class="st-summary ${r.ok ? "is-ok" : "is-fail"}">
      <b>${r.ok ? "همه‌ی قدم‌ها گذشت" : `${fa(failed)} قدم ناموفق`}</b>
      <span>شبکه: ${esc(r.proxy)}</span>
      <button class="btn" type="button" data-st-copy>کپی گزارش</button>
    </div>
    <ol class="st-steps">
      ${r.steps.map((x) => `<li class="st-${x.status}">
        <span class="st-icon" role="img" aria-label="${label[x.status]}">${icon[x.status]}</span>
        <div class="st-body">
          <div class="st-title"><b>${esc(x.title)}</b>${x.ms ? `<span class="meta">${fa(x.ms)} میلی‌ثانیه</span>` : ""}</div>
          ${x.detail ? `<div class="st-detail" dir="auto">${esc(x.detail)}</div>` : ""}
          ${x.hint ? `<div class="st-hint">${esc(x.hint)}</div>` : ""}
        </div>
      </li>`).join("")}
    </ol>`;
}

async function pageProviders(main, q) {
  state.providers = await api("providers");
  if (q.get("open")) state.openProv = q.get("open");
  main.innerHTML = `${head("پیام‌رسان‌ها", "توکن ربات هر پیام‌رسان را ثبت و روشنش کنید. توکن‌ها فقط روی همین سرور می‌مانند و کامل به مرورگر برنمی‌گردند.")}
    <div class="providers" id="provs">${state.providers.map(provHtml).join("")}</div>`;
  const list = document.getElementById("provs");

  const replace = (p) => {
    state.providers = state.providers.map((x) => (x.id === p.id ? p : x));
    list.querySelector(`[data-id="${p.id}"]`).outerHTML = provHtml(p);
  };

  list.addEventListener("click", async (e) => {
    const card = e.target.closest(".prov");
    if (!card) return;
    const id = card.dataset.id;
    const p = state.providers.find((x) => x.id === id);
    if (e.target.closest("[data-expand]")) {
      state.openProv = state.openProv === id ? null : id;
      list.querySelectorAll(".prov").forEach((el) => {
        const o = el.dataset.id === state.openProv;
        el.classList.toggle("open", o);
        const b = el.querySelector("[data-expand]");
        b.setAttribute("aria-expanded", o);
        b.style.transform = `rotate(${o ? 180 : 0}deg)`;
      });
    }
    const reveal = e.target.closest("[data-reveal]");
    if (reveal) { const i = document.getElementById(reveal.dataset.reveal); i.type = i.type === "password" ? "text" : "password"; }
    const testBtn = e.target.closest("[data-test]");
    if (testBtn) {
      const out = card.querySelector("[data-out]");
      const r = await busy(testBtn, () => api(`providers/${id}/test`, { body: {} }));
      out.innerHTML = r.ok
        ? `<div class="result-head"><span class="pill pill-ok">اتصال برقرار است</span><span class="meta">${fa(r.ms)} میلی‌ثانیه</span></div><pre class="json">${jsonHtml(r.result)}</pre>`
        : `<div class="err-box">${esc(r.error)}</div>`;
    }
    if (e.target.closest("[data-selftest]")) {
      const out = card.querySelector("[data-out]");
      const def = p.fields.find((f) => f.key === "defaultChatId")?.value || "";
      out.innerHTML = `<div class="selftest">
        <div class="st-head"><b>تست کامل ${esc(p.nameFa)}</b><span class="hint">شبکه، توکن، چت، ارسال و دریافت را قدم‌به‌قدم بررسی می‌کند.</span></div>
        <div class="st-opts">
          <label class="st-send"><span class="switch"><input type="checkbox" data-st-send><span></span></span>پیام و عکس آزمایشی هم بفرستد</label>
          <input class="input ltr-input" data-st-chat placeholder="${esc(def ? `${def} (default)` : "chat_id مقصد")}" aria-label="چت مقصد">
          <button class="btn btn-primary" type="button" data-st-run>اجرای تست</button>
        </div>
        <div data-st-out></div>
      </div>`;
      out.querySelector("[data-st-run]").focus();
    }
    const runBtn = e.target.closest("[data-st-run]");
    if (runBtn) {
      const box = card.querySelector(".selftest");
      const stOut = box.querySelector("[data-st-out]");
      const send = box.querySelector("[data-st-send]").checked;
      const chatId = box.querySelector("[data-st-chat]").value.trim();
      stOut.innerHTML = `<div class="st-running"><span class="boot-dot"></span>در حال اجرا… ممکن است تا یک دقیقه طول بکشد.</div>`;
      try {
        const r = await busy(runBtn, () => api(`providers/${id}/selftest`, { body: { send, chatId: chatId || undefined } }));
        stOut.innerHTML = selfTestHtml(r);
        stOut.querySelector("[data-st-copy]").onclick = () => copy(r.text);
      } catch (ex) {
        stOut.innerHTML = `<div class="err-box">${esc(ex.message)}</div>`;
      }
    }
    const clearBtn = e.target.closest("[data-clear]");
    if (clearBtn && confirm(`توکن ${p.nameFa} حذف شود؟ ابزارهای این پیام‌رسان از مدل جدا می‌شوند.`)) {
      const keys = p.fields.filter((f) => f.type === "secret").map((f) => f.key);
      replace(await api(`providers/${id}`, { method: "PUT", body: { values: { __clear: keys } } }));
      toast("توکن حذف شد");
    }
  });

  list.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-toggle]")) return;
    const id = e.target.closest(".prov").dataset.id;
    try {
      const p = await api(`providers/${id}`, { method: "PUT", body: { enabled: e.target.checked } });
      replace(p);
      toast(p.enabled ? (p.ready ? `${p.nameFa} روشن شد` : `${p.nameFa} روشن شد؛ توکن را هم ثبت کنید`) : `${p.nameFa} خاموش شد`);
    } catch (ex) { toast(ex.message, true); e.target.checked = !e.target.checked; }
  });

  list.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.closest(".prov").dataset.id;
    const values = {};
    form.querySelectorAll("input[name]:not(:disabled)").forEach((i) => (values[i.name] = i.value.trim()));
    try {
      const p = await busy(form.querySelector("[type=submit]"), () => api(`providers/${id}`, { method: "PUT", body: { values } }));
      state.openProv = id;
      replace(p);
      toast(p.ready ? `تنظیمات ${p.nameFa} ذخیره شد و آماده است` : p.enabled ? `ذخیره شد؛ هنوز کامل نیست` : `ذخیره شد؛ برای استفاده روشنش کنید`);
    } catch (ex) { toast(ex.message, true); }
  });
}

// ---------------------------------------------------------------- playground
function inputFor(name, prop, required, p) {
  const id = `arg-${name}`;
  const desc = prop.description ? `<span class="hint ltr" style="display:block;text-align:right">${esc(prop.description)}</span>` : "";
  const label = `<label for="${id}"><span class="ltr mono">${esc(name)}</span>${required ? '<span class="req">*</span>' : ""}</label>`;
  const type = prop.type || prop.anyOf?.[0]?.type;
  if (prop["x-media"]) return mediaInput(id, name, label, prop["x-media"], prop.description);
  if (type === "boolean")
    return `<div class="field"><span class="field-label">${label}</span><div class="check"><label class="switch"><input type="checkbox" id="${id}" data-arg="${name}" data-type="boolean"><span></span></label></div>${desc}</div>`;
  if (type === "number" || type === "integer")
    return `<div class="field">${label}<input id="${id}" class="input ltr-input" type="number" step="${type === "integer" ? 1 : "any"}" data-arg="${name}" data-type="number" ${prop.minimum !== undefined ? `min="${prop.minimum}"` : ""} ${prop.maximum !== undefined ? `max="${prop.maximum}"` : ""}>${desc}</div>`;
  const long = ["text", "caption"].includes(name);
  const defChat = name === "chat_id" ? p.fields.find((f) => f.key === "defaultChatId")?.value : "";
  const ph = defChat ? `${defChat} (default)` : "";
  return long
    ? `<div class="field wide">${label}<textarea id="${id}" class="textarea" data-arg="${name}" dir="auto"></textarea>${desc}</div>`
    : `<div class="field">${label}<input id="${id}" class="input${/(_id|url|photo)$/.test(name) ? " ltr-input" : ""}" dir="auto" data-arg="${name}" placeholder="${esc(ph)}">${desc}</div>`;
}

// ---------- فیلد رسانه: لینک، file_id یا انتخاب فایل از دستگاه ----------
const MAX_UPLOAD = 20 * 1024 * 1024;
const humanSize = (n) => (n < 1024 * 1024 ? `${fa(Math.max(1, Math.round(n / 1024)))} کیلوبایت` : `${fa((n / 1048576).toFixed(1))} مگابایت`);

function mediaInput(id, name, label, kind, description) {
  const isImage = kind === "image";
  return `<div class="field wide">${label}
    <div class="media-box" data-media="${kind}">
      <div class="media-preview" aria-hidden="true">${isImage ? icons.image : icons.file}</div>
      <div class="media-body">
        <div class="media-row">
          <input id="${id}" class="input ltr-input" data-arg="${name}" data-type="media" placeholder="https://…  یا  file_id" autocomplete="off">
          <button type="button" class="btn" data-pick>${isImage ? "انتخاب عکس" : "انتخاب فایل"}</button>
          <button type="button" class="btn btn-icon btn-quiet" data-clear-media hidden aria-label="حذف فایل">✕</button>
        </div>
        <span class="hint">لینک بدهید، فایل را انتخاب کنید، یا آن را هر جای صفحه بکشید و رها کنید${isImage ? " (Ctrl+V هم کار می‌کند)" : ""}. حداکثر ۲۰ مگابایت.</span>
      </div>
      <input type="file" hidden data-file ${isImage ? 'accept="image/*"' : ""}>
    </div>
  </div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:([^;,]*)/, (m, mime) => `data:${mime || "application/octet-stream"};name=${encodeURIComponent(file.name)}`));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function bindMediaFields(root) {
  root.querySelectorAll(".media-box").forEach((box) => {
    const input = box.querySelector("[data-arg]");
    const picker = box.querySelector("[data-file]");
    const preview = box.querySelector(".media-preview");
    const clearBtn = box.querySelector("[data-clear-media]");
    const isImage = box.dataset.media === "image";
    let objectUrl = null;

    const showIcon = () => { preview.innerHTML = isImage ? icons.image : icons.file; preview.classList.remove("has-img"); };
    const showImg = (src) => {
      const img = new Image();
      img.alt = "";
      img.onload = () => { preview.replaceChildren(img); preview.classList.add("has-img"); };
      img.onerror = showIcon;
      img.src = src;
    };
    const reset = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      delete input.dataset.dataUrl;
      input.readOnly = false;
      input.value = "";
      input.classList.add("ltr-input");
      clearBtn.hidden = true;
      showIcon();
    };
    const useFile = async (file) => {
      if (!file) return;
      if (file.size > MAX_UPLOAD) return toast(`حجم «${file.name}» بیشتر از ۲۰ مگابایت است`, true);
      if (isImage && !file.type.startsWith("image/")) return toast("این فایل عکس نیست", true);
      reset();
      input.dataset.dataUrl = await fileToDataUrl(file);
      input.value = `${file.name} — ${humanSize(file.size)}`;
      input.readOnly = true;
      input.classList.remove("ltr-input");
      clearBtn.hidden = false;
      if (file.type.startsWith("image/")) showImg((objectUrl = URL.createObjectURL(file)));
      else showIcon();
    };

    box.querySelector("[data-pick]").onclick = () => picker.click();
    picker.onchange = () => { useFile(picker.files[0]); picker.value = ""; };
    clearBtn.onclick = () => { reset(); input.focus(); };
    input.addEventListener("input", () => {
      const v = input.value.trim();
      if (isImage && /^https?:\/\/\S+$/i.test(v)) showImg(v);
      else showIcon();
    });
    box._useFile = useFile;
    box._useUrl = (url) => { reset(); input.value = url.trim(); input.dispatchEvent(new Event("input")); };
  });
}

// ---------- کشیدن و رها کردن / چسباندن در کل صفحه ----------
// فایل در هر جای صفحه رها شود به فیلد رسانه‌ی ابزار باز می‌رود، و مرورگر هیچ‌وقت
// به‌جای ارسال، خود فایل را باز نمی‌کند.
const draggingFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
let dragDepth = 0;
const endDrag = () => { dragDepth = 0; document.body.classList.remove("file-drag"); };
window.addEventListener("dragenter", (e) => {
  if (!draggingFiles(e)) return;
  dragDepth++;
  document.body.classList.add("file-drag");
});
window.addEventListener("dragleave", (e) => {
  if (!draggingFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) endDrag();
});
window.addEventListener("dragover", (e) => {
  if (draggingFiles(e) || e.target.closest?.(".media-box")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = document.querySelector(".media-box") ? "copy" : "none";
  }
});
window.addEventListener("drop", (e) => {
  endDrag();
  const box = e.target.closest?.(".media-box") ?? document.querySelector(".media-box");
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    e.preventDefault();
    if (box?._useFile) box._useFile(file);
    else toast("برای ارسال فایل، اول در «آزمایش ابزارها» یک ابزار ارسال عکس یا فایل را باز کنید", true);
    return;
  }
  // لینک یا عکسی که از یک سایت دیگر کشیده شده
  if (e.target.closest?.(".media-box") && box?._useUrl) {
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (url && /^https?:\/\//i.test(url.trim())) { e.preventDefault(); box._useUrl(url); }
  }
});
document.addEventListener("dragend", endDrag);

document.addEventListener("paste", (e) => {
  const box = document.querySelector('.media-box[data-media="image"]') ?? document.querySelector(".media-box");
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file");
  if (!box?._useFile || !item) return;
  if (box.dataset.media === "image" && !item.type.startsWith("image/")) return;
  e.preventDefault();
  const f = item.getAsFile();
  const generic = !f.name || /^image\.\w+$/.test(f.name);
  box._useFile(generic ? new File([f], `clipboard-${Date.now()}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }) : f);
});

/** برای نمایش «ورودی JSON»: data URLها کوتاه نشان داده می‌شوند */
function shortenDataUrls(args) {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.startsWith("data:") ? `${v.slice(0, v.indexOf(","))},… (${humanSize(v.length * 0.75)})` : v]));
}

async function pagePlayground(main, q) {
  state.providers = await api("providers");
  const all = state.providers.flatMap((p) => p.tools.map((t) => ({ ...t, p })));
  const selected = all.find((t) => t.name === q.get("tool")) ?? all.find((t) => t.p.ready) ?? all[0];
  main.innerHTML = `${head("آزمایش ابزارها", "هر ابزار را همان‌طور که مدل صدا می‌زند اجرا کنید و پاسخ خام سرویس را ببینید.")}
    <div class="play">
      <nav class="tool-list" aria-label="ابزارها">
        ${state.providers.map((p) => `
          <div class="tool-group"><i style="background:${p.color}"></i>${esc(p.nameFa)}${status(p)}</div>
          ${p.tools.map((t) => `<button class="tool-btn" data-tool="${t.name}" aria-pressed="${t.name === selected?.name}">${esc(t.title)}<small>${esc(t.name)}</small></button>`).join("")}`).join("")}
      </nav>
      <div id="tool-pane"></div>
    </div>`;

  main.querySelector(".tool-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool]");
    if (b) history.replaceState(null, "", `#/playground?tool=${b.dataset.tool}`), pagePlayground(main, new URLSearchParams(`tool=${b.dataset.tool}`));
  });
  if (!selected) return;

  const t = selected, p = t.p;
  const props = t.schema.properties || {};
  const req = t.schema.required || [];
  const pane = document.getElementById("tool-pane");
  pane.innerHTML = `
    <section class="panel">
      <div class="result-head"><h2>${esc(t.title)}</h2>${t.annotations.readOnlyHint ? '<span class="pill pill-off">فقط خواندنی</span>' : '<span class="pill pill-warn">ارسال واقعی</span>'}</div>
      <p class="desc">${esc(t.description)}</p>
      ${p.ready ? "" : `<div class="err-box" style="margin-bottom:18px">${esc(p.nameFa)} هنوز آماده نیست. <a href="#/providers?open=${p.id}">توکن را ثبت و روشنش کنید</a>.</div>`}
      <form id="tool-form">
        <div class="tool-form">${Object.keys(props).length ? Object.entries(props).map(([k, v]) => inputFor(k, v, req.includes(k), p)).join("") : '<p class="hint wide">این ابزار ورودی ندارد.</p>'}</div>
        <div class="prov-actions" style="margin-top:20px">
          <button class="btn btn-primary" type="submit" ${p.ready ? "" : "disabled"}>اجرای ابزار</button>
          <button class="btn btn-quiet" type="button" id="show-args">ورودی JSON</button>
        </div>
      </form>
    </section>
    <section class="panel" id="result" hidden></section>`;

  const collect = () => {
    const args = {};
    pane.querySelectorAll("[data-arg]").forEach((el) => {
      const k = el.dataset.arg;
      if (el.dataset.type === "boolean") { if (el.checked) args[k] = true; return; }
      if (el.dataset.type === "media" && el.dataset.dataUrl) { args[k] = el.dataset.dataUrl; return; }
      const v = el.value.trim();
      if (v === "") return;
      args[k] = el.dataset.type === "number" ? Number(v) : v;
    });
    return args;
  };
  const result = document.getElementById("result");
  document.getElementById("show-args").onclick = () => {
    result.hidden = false;
    result.innerHTML = `<div class="result-head"><h2>ورودی</h2></div><pre class="json">${jsonHtml(shortenDataUrls(collect()))}</pre>`;
  };
  bindMediaFields(pane);
  document.getElementById("tool-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    if (!t.annotations.readOnlyHint && !confirm(`این ابزار واقعاً در ${p.nameFa} ارسال انجام می‌دهد. ادامه می‌دهید؟`)) return;
    const r = await busy(btn, () => api(`tools/${t.name}/call`, { body: { args: collect() } }));
    result.hidden = false;
    result.innerHTML = `<div class="result-head"><h2>پاسخ</h2>${r.ok ? '<span class="pill pill-ok">موفق</span>' : '<span class="pill pill-err">ناموفق</span>'}<span class="meta">${fa(r.ms)} میلی‌ثانیه</span></div>
      ${r.ok ? `<pre class="json">${jsonHtml(r.result)}</pre>` : `<div class="err-box">${esc(r.error)}</div>`}`;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

// ---------------------------------------------------------------- inbox
const chatTypeFa = { private: "خصوصی", group: "گروه", channel: "کانال", unknown: "" };
const kindFa = { photo: "عکس", file: "فایل", video: "ویدیو", voice: "صوت", location: "موقعیت", button: "دکمه", other: "" };

function receiverHtml(p, st) {
  if (!st.supported)
    return `<div class="rcv off"><div class="disc sm" style="background:${p.color}">${esc(p.glyph)}</div><div class="rcv-body"><b>${esc(p.nameFa)}</b><span class="hint">ایتایار دریافت پیام ندارد؛ فقط ارسال به کانال و گروه.</span></div></div>`;
  const ready = p.ready;
  let pill, info = "";
  if (!ready) { pill = '<span class="pill pill-off">توکن ثبت نشده</span>'; info = `<a href="#/providers?open=${p.id}">ثبت توکن</a>`; }
  else if (st.lastError) { pill = '<span class="pill pill-err">خطا</span>'; info = `<span class="err" title="${esc(st.lastError)}">${esc(st.lastError)}</span>`; }
  else if (st.running) { pill = '<span class="pill pill-ok">در حال دریافت</span>'; info = st.lastPollAt ? `آخرین بررسی ${ago(st.lastPollAt)}` : "در حال اتصال…"; }
  else pill = '<span class="pill pill-off">خاموش</span>';
  const webhook = /webhook/i.test(st.lastError || "");
  return `<div class="rcv${st.lastError ? " has-err" : ""}" data-rcv="${p.id}">
    <div class="disc sm" style="background:${p.color}">${esc(p.glyph)}</div>
    <div class="rcv-body">
      <div class="rcv-top"><b>${esc(p.nameFa)}</b>${pill}</div>
      <span class="hint">${info}</span>
      ${st.hint ? `<span class="st-hint">${esc(st.hint)}</span>` : ""}
    </div>
    <div class="rcv-actions">
      ${webhook ? `<button class="btn btn-danger" data-action="deleteWebhook">حذف وبهوک</button>` : ""}
      <button class="btn" data-fetch ${ready ? "" : "disabled"}>بررسی الان</button>
      <label class="switch" title="دریافت خودکار"><input type="checkbox" data-receive ${st.enabled ? "checked" : ""} ${ready && !p.receive.fromEnv ? "" : "disabled"} aria-label="دریافت خودکار ${esc(p.nameFa)}"><span></span></label>
    </div>
  </div>`;
}

async function pageInbox(main, q) {
  state.providers = await api("providers");
  const sel = { p: q.get("p") || "", c: q.get("c") || "" };
  let data = { statuses: [], chats: [], messages: [] };
  let lastSig = "";

  main.innerHTML = `${head("پیام‌های دریافتی", "گفتگوهای ربات‌ها: پیام‌هایی که کاربران می‌دهند و پیام‌هایی که ربات فرستاده. از اینجا شناسه‌ی چت‌ها را پیدا کنید، چت پیش‌فرض را تعیین کنید و جواب بدهید.")}
    <section class="receivers" id="rcv"></section>
    <p class="note rcv-note">«دریافت خودکار» پیام‌های ربات را مرتب می‌خواند و ابزار get_updates مدل هم از همین صندوق جواب می‌دهد. اگر برنامه‌ی دیگری (وبهوک یا ربات دیگر) هم پیام‌های همین ربات را می‌خواند، روشنش نکنید؛ «بررسی الان» هم پیام‌ها را برمی‌دارد.</p>
    <section class="inbox">
      <nav class="chat-list" id="chats" aria-label="چت‌ها"></nav>
      <div class="convo" id="convo"></div>
    </section>`;

  const provOf = (id) => state.providers.find((x) => x.id === id);
  const defaultChat = (id) => provOf(id)?.fields.find((f) => f.key === "defaultChatId")?.value || "";

  const drawReceivers = () => {
    document.getElementById("rcv").innerHTML = data.statuses.map((st) => receiverHtml(provOf(st.provider), st)).join("");
  };

  const drawChats = () => {
    const el = document.getElementById("chats");
    if (!data.chats.length) {
      el.innerHTML = `<div class="empty"><b>هنوز پیامی نیامده</b>دریافت خودکار را روشن کنید یا «بررسی الان» را بزنید، بعد از گوشی یک پیام به ربات بدهید.</div>`;
      return;
    }
    el.innerHTML = data.chats.map((c) => {
      const p = provOf(c.provider);
      const active = c.provider === sel.p && c.chatId === sel.c;
      const isDef = defaultChat(c.provider) === c.chatId;
      return `<button class="chat-item" data-p="${c.provider}" data-c="${esc(c.chatId)}" aria-current="${active}">
        <span class="disc xs" style="background:${p.color}">${esc(p.glyph)}</span>
        <span class="ci-body">
          <span class="ci-top"><b dir="auto">${esc(c.title || c.chatId)}</b><span class="meta">${ago(c.lastDate)}</span></span>
          <span class="ci-sub">${c.lastDirection === "out" ? '<span class="ci-you">شما: </span>' : ""}<span dir="auto">${esc(kindFa[c.lastText] ?? c.lastText ?? "—")}</span></span>
          <span class="ci-tags">${chatTypeFa[c.type] ? `<i>${chatTypeFa[c.type]}</i>` : ""}${isDef ? "<i class='def'>پیش‌فرض</i>" : ""}<i>${fa(c.count)} پیام</i></span>
        </span>
      </button>`;
    }).join("");
  };

  const drawConvo = () => {
    const el = document.getElementById("convo");
    const chat = data.chats.find((c) => c.provider === sel.p && c.chatId === sel.c);
    if (!chat) {
      el.innerHTML = `<div class="empty convo-empty">${icons.inbox}<b>یک چت را انتخاب کنید</b>شناسه‌ی چت، پیام‌ها و ارسال جواب اینجا نمایش داده می‌شود.</div>`;
      return;
    }
    const p = provOf(chat.provider);
    const isDef = defaultChat(chat.provider) === chat.chatId;
    const keepDraft = el.querySelector("[data-draft]")?.value ?? "";
    el.innerHTML = `
      <header class="convo-head">
        <div><b dir="auto">${esc(chat.title || chat.chatId)}</b>
          <div class="convo-id"><span class="meta">${esc(p.nameFa)}${chatTypeFa[chat.type] ? ` · ${chatTypeFa[chat.type]}` : ""} · chat_id</span>
          <code class="ltr">${esc(chat.chatId)}</code><button class="btn btn-quiet btn-sm" data-copy-id>کپی</button></div>
        </div>
        ${isDef ? `<span class="pill pill-ok">چت پیش‌فرض ${esc(p.nameFa)}</span>` : `<button class="btn" data-set-default>تنظیم به‌عنوان چت پیش‌فرض</button>`}
      </header>
      <ol class="msgs" id="msgs">
        ${data.messages.slice().reverse().map((m) => {
          const out = m.direction === "out";
          const time = new Date(m.date).toLocaleString("fa-IR", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
          const who = out
            ? `<b>ربات</b><span>${m.source === "mcp" ? "از طرف هوش مصنوعی" : "از داشبورد"}</span>`
            : `${m.from?.name ? `<b dir="auto">${esc(m.from.name)}</b>` : ""}${m.from?.username ? `<span class="ltr">@${esc(m.from.username)}</span>` : ""}`;
          const img = out && m.kind === "photo" && m.mediaUrl ? `<img class="msg-img" src="${esc(m.mediaUrl)}" alt="" loading="lazy" onerror="this.remove()">` : "";
          return `<li class="msg${out ? " out" : ""}">
            <div class="msg-meta">${who}<span>${time}</span></div>
            ${img}
            ${kindFa[m.kind] ? `<span class="msg-kind">${kindFa[m.kind]}${m.buttonId ? `: <code class="ltr">${esc(m.buttonId)}</code>` : ""}</span>` : ""}
            ${m.text ? `<p dir="auto">${esc(m.text)}</p>` : ""}
          </li>`;
        }).join("")}
      </ol>
      <form class="composer" data-reply>
        <textarea class="textarea" data-draft rows="2" dir="auto" placeholder="جواب به ${esc(chat.title || chat.chatId)}…" aria-label="متن جواب"></textarea>
        <button class="btn btn-primary" type="submit" ${p.ready ? "" : "disabled"}>${icons.send}ارسال</button>
      </form>`;
    el.querySelector("[data-draft]").value = keepDraft;
    const list = document.getElementById("msgs");
    list.scrollTop = list.scrollHeight;
  };

  const load = async (force = false) => {
    const qs = sel.p && sel.c ? `?provider=${encodeURIComponent(sel.p)}&chat=${encodeURIComponent(sel.c)}` : "";
    data = await api(`inbox${qs}`);
    const sig = JSON.stringify([data.statuses.map((s) => [s.enabled, s.running, s.lastError, s.received, s.lastPollAt && ago(s.lastPollAt)]), data.chats.map((c) => c.lastDate + c.count), data.messages.length, data.messages[0]?.key, sel]);
    drawReceivers();
    if (force || sig !== lastSig) { drawChats(); drawConvo(); }
    lastSig = sig;
  };
  await load(true);
  state.timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 4000);

  main.addEventListener("click", async (e) => {
    const item = e.target.closest(".chat-item");
    if (item) {
      sel.p = item.dataset.p; sel.c = item.dataset.c;
      history.replaceState(null, "", `#/inbox?p=${sel.p}&c=${encodeURIComponent(sel.c)}`);
      await load(true);
      return;
    }
    const rcv = e.target.closest("[data-rcv]");
    if (rcv && e.target.closest("[data-fetch]")) {
      const r = await busy(e.target.closest("[data-fetch]"), () => api(`inbox/${rcv.dataset.rcv}/fetch`, { body: {} }));
      r.ok ? toast(r.added ? `${fa(r.added)} پیام جدید` : "پیام جدیدی نبود") : toast(r.error, true);
      return load(true);
    }
    const act = e.target.closest("[data-action]");
    if (rcv && act) {
      const r = await busy(act, () => api(`providers/${rcv.dataset.rcv}/actions/${act.dataset.action}`, { body: {} }));
      r.ok ? toast("وبهوک حذف شد؛ دریافت دوباره امتحان می‌شود") : toast(r.error, true);
      return load(true);
    }
    if (e.target.closest("[data-copy-id]")) return copy(sel.c);
    if (e.target.closest("[data-set-default]")) {
      const updated = await api(`providers/${sel.p}`, { method: "PUT", body: { values: { defaultChatId: sel.c } } });
      state.providers = state.providers.map((x) => (x.id === updated.id ? updated : x));
      toast(`چت پیش‌فرض ${updated.nameFa} تعیین شد`);
      return load(true);
    }
  });

  main.addEventListener("change", async (e) => {
    const sw = e.target.closest("[data-receive]");
    if (!sw) return;
    const id = sw.closest("[data-rcv]").dataset.rcv;
    try {
      await api(`inbox/${id}/receive`, { body: { enabled: sw.checked } });
      toast(sw.checked ? `دریافت خودکار ${provOf(id).nameFa} روشن شد` : `دریافت خودکار ${provOf(id).nameFa} خاموش شد`);
    } catch (ex) { sw.checked = !sw.checked; toast(ex.message, true); }
    setTimeout(() => load(true), 600);
  });

  main.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-reply]");
    if (!form) return;
    e.preventDefault();
    const draft = form.querySelector("[data-draft]");
    const text = draft.value.trim();
    if (!text) return draft.focus();
    const r = await busy(form.querySelector("[type=submit]"), () => api(`tools/${sel.p}_send_message/call`, { body: { args: { chat_id: sel.c, text } } }));
    if (r.ok) { draft.value = ""; await load(true); } else toast(r.error, true);
  });
  main.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("[data-draft]")) e.target.closest("form").requestSubmit();
  });
}

// ---------------------------------------------------------------- logs
async function pageLogs(main) {
  if (!state.providers.length) state.providers = await api("providers");
  main.innerHTML = `${head("گزارش فراخوانی‌ها", "سیصد فراخوانی آخر، چه از طرف مدل و چه از داشبورد. همه‌ی فراخوانی‌ها در پوشه‌ی data/logs هم ذخیره می‌شوند.",
    `<div class="toolbar" style="margin:0">
      <button class="btn btn-icon" id="reload" aria-label="به‌روزرسانی">${icons.refresh}</button>
      <button class="btn btn-quiet btn-danger" id="clear">پاک کردن گزارش‌ها</button></div>`)}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="وضعیت">
        ${[["all", "همه"], ["ok", "موفق"], ["fail", "ناموفق"]].map(([v, l]) => `<button data-ok="${v}" aria-pressed="${state.logFilter.ok === v}">${l}</button>`).join("")}
      </div>
      <select class="select" id="pf" aria-label="پیام‌رسان">
        <option value="">همه‌ی پیام‌رسان‌ها</option>
        ${state.providers.map((p) => `<option value="${p.id}" ${state.logFilter.provider === p.id ? "selected" : ""}>${esc(p.nameFa)}</option>`).join("")}
      </select>
    </div>
    <div class="calls" id="log-list"></div>`;

  const list = document.getElementById("log-list");
  let openId = null;
  const draw = () => {
    const f = state.logFilter;
    const rows = state.logs.filter((l) => (f.ok === "all" || (f.ok === "ok") === l.ok) && (!f.provider || l.provider === f.provider));
    list.innerHTML = rows.length
      ? rows.map((l) => callRow(l, true) + (l.id === openId ? `<div class="call-detail"><div class="tool-form" style="padding-top:14px">
          <div><div class="hint">ورودی</div><pre class="json">${jsonHtml(l.args)}</pre></div>
          <div><div class="hint">${l.ok ? "پاسخ" : "خطا"}</div>${l.ok ? `<pre class="json">${l.result ? jsonHtml(JSON.parse(l.result)) : ""}</pre>` : `<div class="err-box">${esc(l.error)}</div>`}</div>
        </div></div>` : "")).join("")
      : `<div class="empty"><b>گزارشی با این فیلتر نیست</b>فیلترها را عوض کنید یا یک ابزار اجرا کنید.</div>`;
  };
  const load = async () => { state.logs = await api("logs?limit=300"); draw(); };
  await load();
  state.timer = setInterval(() => { if (!openId) load().catch(() => {}); }, 5000);

  list.addEventListener("click", (e) => {
    const r = e.target.closest("[data-log]");
    if (r) { openId = openId === r.dataset.log ? null : r.dataset.log; draw(); }
  });
  list.addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.closest("[data-log]")?.click(); });
  main.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ok]");
    if (!b) return;
    state.logFilter.ok = b.dataset.ok;
    main.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    draw();
  });
  document.getElementById("pf").onchange = (e) => { state.logFilter.provider = e.target.value; draw(); };
  document.getElementById("reload").onclick = (e) => busy(e.currentTarget, load);
  document.getElementById("clear").onclick = async () => {
    if (!confirm("همه‌ی گزارش‌ها، از جمله فایل‌های ذخیره‌شده، پاک شود؟")) return;
    await api("logs", { method: "DELETE" });
    await load();
    toast("گزارش‌ها پاک شد");
  };
}

// ---------------------------------------------------------------- connect
async function pageConnect(main) {
  const c = await api("connection");
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  const url = base + "mcp";
  const snippets = {
    "Claude Code": { lang: "bash", code: `claude mcp add --transport http diba-mcp ${url} \\\n  --header "Authorization: Bearer ${c.token}"` },
    "Cursor / کلاینت‌های JSON": { lang: "json", code: JSON.stringify({ mcpServers: { "diba-mcp": { url, headers: { Authorization: `Bearer ${c.token}` } } } }, null, 2) },
    "Claude Desktop (stdio)": {
      lang: "json",
      code: JSON.stringify({ mcpServers: { "diba-mcp": { command: "npx", args: ["-y", "diba-mcp", "stdio"] } } }, null, 2),
      note: "در حالت stdio سرور روی همان کامپیوتر اجرا می‌شود و تنظیمات را از ~/.diba-mcp می‌خواند (همان پوشه‌ای که npx diba-mcp برای داشبورد استفاده می‌کند)؛ توکن MCP لازم نیست. پوشه‌ی دیگر: \"--data\", \"/path\" را به args اضافه کنید.",
    },
    "الحاق به پروژه‌ی Express": {
      lang: "js",
      code: `import express from "express";\nimport { createDibaMcp } from "diba-mcp";\n\nconst app = express();\nconst dibaMcp = createDibaMcp({ dataDir: "./data/diba-mcp" });\n\n// داشبورد در /diba-mcp/ و اندپوینت در /diba-mcp/mcp\napp.use("/diba-mcp", dibaMcp.router());\n\n// یا فراخوانی مستقیم از کد خودتان\nawait dibaMcp.engine.callTool("bale_send_message", { text: "سفارش جدید ثبت شد" }, "dashboard");`,
    },
    "تست با curl": {
      lang: "bash",
      code: `curl -s ${url} \\\n  -H "Authorization: Bearer ${c.token}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    },
  };
  let tab = Object.keys(snippets)[0];

  main.innerHTML = `${head("اتصال به هوش مصنوعی", "این آدرس و توکن را به هر کلاینتی که MCP را پشتیبانی می‌کند بدهید.")}
    <div class="conn-grid">
      <section class="panel">
        <div class="field"><label for="ep">آدرس اندپوینت MCP</label>
          <div class="endpoint"><input id="ep" class="input ltr-input" readonly value="${esc(url)}"><button class="btn" data-copy="${esc(url)}">کپی</button></div>
          <span class="hint">انتقال: Streamable HTTP، بدون نشست. فقط درخواست POST.</span></div>
        <div class="field" style="margin-top:18px"><label for="tk">توکن دسترسی${c.fromEnv ? '<span class="env-badge">از env</span>' : ""}</label>
          <div class="endpoint">
            <div class="input-wrap"><input id="tk" type="password" class="input ltr-input" readonly value="${esc(c.token)}"><button class="btn btn-icon btn-quiet" data-reveal="tk" aria-label="نمایش">${icons.eye}</button></div>
            <button class="btn" data-copy="${esc(c.token)}">کپی</button>
          </div>
          <span class="hint">در هدر <code class="ltr">Authorization: Bearer …</code> فرستاده می‌شود. هر کسی این توکن را داشته باشد می‌تواند از طرف ربات‌های شما پیام بفرستد.</span>
        </div>
        ${c.fromEnv ? "" : `<div class="prov-actions" style="margin-top:16px"><button class="btn btn-danger" id="rotate">ساخت توکن جدید</button></div>`}
      </section>
      <section class="panel">
        <div class="tabs" role="tablist">${Object.keys(snippets).map((k) => `<button role="tab" data-tab="${esc(k)}" aria-selected="${k === tab}">${esc(k)}</button>`).join("")}</div>
        <div id="snip"></div>
      </section>
    </div>`;

  const drawSnip = () => {
    const s = snippets[tab];
    document.getElementById("snip").innerHTML = `<div class="snippet"><pre class="json">${esc(s.code)}</pre><button class="btn" data-copy-snip>کپی</button></div>${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}`;
  };
  drawSnip();
  main.querySelector(".conn-grid").addEventListener("click", async (e) => {
    const cp = e.target.closest("[data-copy]");
    if (cp) copy(cp.dataset.copy);
    if (e.target.closest("[data-copy-snip]")) copy(snippets[tab].code);
    const rv = e.target.closest("[data-reveal]");
    if (rv) { const i = document.getElementById(rv.dataset.reveal); i.type = i.type === "password" ? "text" : "password"; }
    const tb = e.target.closest("[data-tab]");
    if (tb) { tab = tb.dataset.tab; main.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b === tb)); drawSnip(); }
    if (e.target.closest("#rotate") && confirm("توکن فعلی باطل می‌شود و همه‌ی کلاینت‌ها باید توکن جدید بگیرند. ادامه می‌دهید؟")) {
      await api("connection/rotate", { body: {} });
      toast("توکن جدید ساخته شد");
      pageConnect(main);
    }
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  clearInterval(state.timer);
  let s;
  try { s = await api("auth/status"); }
  catch { $app.innerHTML = `<div class="boot"><div class="err-box">به سرور وصل نشد. مطمئن شوید diba-mcp در حال اجراست و صفحه را دوباره باز کنید.</div></div>`; return; }
  if (!s.authenticated) return renderAuth(s.needsSetup);
  renderShell();
  document.getElementById("ver").textContent = `نسخه ${s.version}`;
  render();
}

window.addEventListener("hashchange", () => { if (document.getElementById("main")) render(); });
boot();
