"use strict";
(() => {
const SOURCE = "https://repo.zrh.jp/source.json";
const $ = (id) => document.getElementById(id);
const appsRoot = $("apps");
let apps = [];
function notify(message) { const el = $("toast"); el.textContent = message; el.hidden = false; clearTimeout(notify.t); notify.t = setTimeout(() => { el.hidden = true; }, 3500); }
async function copyURL() { try { await navigator.clipboard.writeText(SOURCE); notify("软件源地址已复制"); } catch { const input = document.createElement("textarea"); input.value = SOURCE; document.body.append(input); input.select(); document.execCommand("copy"); input.remove(); notify("软件源地址已复制"); } }
$("copySource").addEventListener("click", copyURL);
$("copyBottom").addEventListener("click", copyURL);
$("searchApps").addEventListener("input", render);
function element(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; }
function secureURL(value) { try { const u = new URL(value, location.href); return u.protocol === "https:" ? u.href : null; } catch { return null; } }
function defaultIcon() { return "./icon.svg"; }
function render() {
  const q = $("searchApps").value.toLowerCase().trim();
  appsRoot.replaceChildren();
  const filtered = apps.filter(a => ((a.name || "") + " " + (a.bundleIdentifier || "")).toLowerCase().includes(q));
  if (!filtered.length) { const e = element("div", "empty"); e.append(element("span", "empty-illustration", "◇"), element("h3", "", q ? "没有搜索结果" : "还没有发布应用"), element("p", "", q ? "试试其他关键词。" : "应用发布后会自动显示在这里。你可以先把软件源添加到 AltStore Classic。")); appsRoot.append(e); return; }
  for (const app of filtered) {
    const card = element("article", "app-card");
    const head = element("div", "app-head");
    const icon = element("img", "app-icon"); icon.alt = ""; icon.loading = "lazy"; icon.src = secureURL(app.iconURL) || defaultIcon(); icon.addEventListener("error", () => { icon.src = defaultIcon(); }, {once:true});
    const idbox = element("div", "app-idbox");
    idbox.append(element("h3", "app-name", app.name || "未命名应用"), element("span", "app-id", app.bundleIdentifier || ""));
    head.append(icon, idbox); card.append(head, element("p", "app-desc", app.localizedDescription || app.subtitle || "暂无描述"));
    const versions = Array.isArray(app.versions) ? app.versions : [];
    const latest = versions[0];
    const bottom = element("div", "app-footer");
    bottom.append(element("div", "version", latest ? "版本 " + latest.version + " · " + (latest.date || "") : "暂无可用版本"));
    const url = latest && secureURL(latest.downloadURL);
    if (url) { const download = element("a", "download", "下载 IPA ↗"); download.href = url; download.rel = "noopener noreferrer"; download.target = "_blank"; bottom.append(download); }
    card.append(bottom);
    if (versions.length > 1) { const history = element("details", "app-history"); const summary = element("summary", "", "查看历史版本 (" + versions.length + ")"); history.append(summary); for (const v of versions) { const link = secureURL(v.downloadURL); if (!link) continue; const anchor = element("a", "", "v" + v.version + " (" + v.buildVersion + ") · " + (v.date || "无日期")); anchor.href = link; anchor.rel = "noopener"; history.append(anchor); } card.append(history); }
    appsRoot.append(card);
  }
}
async function load() {
  try {
    const r = await fetch("./source.json?ts=" + Date.now(), {cache:"no-store"});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    if (!data || !Array.isArray(data.apps)) throw new Error("JSON 格式不正确");
    apps = data.apps;
    $("appCount").textContent = apps.length;
    $("versionCount").textContent = apps.reduce((n, a) => n + (Array.isArray(a.versions) ? a.versions.length : 0), 0);
    $("status").textContent = "运行正常";
    $("status").className = "number good";
    render();
  } catch (error) {
    $("status").textContent = "尚未上线";
    $("status").className = "number bad";
    appsRoot.replaceChildren();
    const box = element("div", "empty"); box.append(element("span", "empty-illustration", "◇"), element("h3", "", "暂时无法读取软件源"), element("p", "", "请检查 GitHub Pages 是否开启，以及自定义域名 DNS 是否生效。")); appsRoot.append(box);
    console.error("Source load failed:", error);
  }
}
load();
})();