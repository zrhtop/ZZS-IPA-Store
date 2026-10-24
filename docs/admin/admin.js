"use strict";
(async function () {
  const $ = (id) => document.getElementById(id);
  try {
    const res = await fetch("../source.json?cache=" + Date.now(), {cache:"no-store"});
    if (!res.ok) throw Error("HTTP " + res.status);
    const data = await res.json();
    if (!Array.isArray(data.apps)) throw Error("Invalid source");
    $("appCount").textContent = data.apps.length;
    $("versionCount").textContent = data.apps.reduce((n,app)=> n + (Array.isArray(app.versions) ? app.versions.length : 0),0);
    $("sourceStatus").textContent = "运行正常";
    $("sourceStatus").className = "source-status ok";
    $("sourceDesc").textContent = "软件源已发布";
  } catch {
    $("sourceStatus").textContent = "暂未就绪";
    $("sourceStatus").className = "source-status error";
    $("sourceDesc").textContent = "检查 GitHub Pages 配置";
  }
})();