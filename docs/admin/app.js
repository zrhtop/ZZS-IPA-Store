"use strict";
(() => {
  const REPO = "zrhtop/ZZS-IPA-Store";
  const BRANCH = "main";
  const ROOT = "docs/";
  const API = "https://api.github.com/repos/" + REPO;
  const SOURCE_PATH = ROOT + "source.json";
  const SOURCE_URL = "https://repo.zrh.jp/source.json";
  const DEFAULT_ICON = "https://avatars.githubusercontent.com/u/101614537?v=4";
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
  const CATEGORIES = new Set(["developer","entertainment","games","lifestyle","other","photo-video","social","utilities"]);
  const $ = (id) => document.getElementById(id);
  const state = {token:null,source:null,sha:null,mode:"new-app",bundle:null,index:-1,file:null,busy:false,selectedTab:"dashboard"};
  function node(tag, className, value) {const el=document.createElement(tag);if(className)el.className=className;if(value !== undefined)el.textContent=String(value);return el;}
  function friendlyError(err) {return err && err.message ? err.message : String(err);}
  let toastTimeout;
  function toast(message, error=false) {const el=$("toast");el.textContent=message;el.classList.toggle("error",error);el.hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>{el.hidden=true;},6000);}
  function inline(message) {$("editorMessage").textContent=message || "";}
  function bytesToBase64(bytes) {
    const chunks=[];const step=16384;
    for(let i=0;i<bytes.length;i+=step)chunks.push(String.fromCharCode(...bytes.subarray(i,i+step)));
    return btoa(chunks.join(""));
  }
  function toBase64(str){return bytesToBase64(new TextEncoder().encode(str));}
  function decodeBase64(encoded) {
    const clean=String(encoded).replace(/\s+/g,"");
    const raw=atob(clean),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function safeHTTPS(value) {
    if(!value)return "";
    try {const url=new URL(String(value));return url.protocol === "https:" ? url.href : "";} catch {return "";}
  }
  function safeURLOrThrow(value,field) {
    const clean=String(value||"").trim();if(!clean)return "";
    const url=safeHTTPS(clean);if(!url)throw new Error(field+" 必须是完整的 HTTPS 地址");
    return url;
  }
  function escSlug(str) {return String(str).replace(/[^a-zA-Z0-9._-]+/g,"_").replace(/^\.+/,"").slice(0,90)||"app";}
  function shortSize(num){if(!Number.isFinite(+num)||+num<=0)return "未知大小";return +num > 1048576 ? (+num/1048576).toFixed(1)+" MiB" : (+num/1024).toFixed(0)+" KiB";}
  async function request(endpoint, options={}) {
    const {method="GET",body,auth=true}=options;
    const headers={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
    if(auth && state.token)headers.Authorization="Bearer "+state.token;
    if(body!==undefined)headers["Content-Type"]="application/json";
    let response;
    try {response=await fetch(API+endpoint,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",referrerPolicy:"no-referrer"});}
    catch {throw new Error("无法连接 GitHub API。请检查网络连接或浏览器限制。");}
    if(!response.ok) {
      let message="";
      try{const payload=await response.json();message=payload.message||"";}catch{}
      if(response.status===401)throw new Error("令牌无效或已过期，请重新连接。");
      if(response.status===403)throw new Error("GitHub 拒绝访问（403）。请确认 Token 对本仓库具有 Contents 读写权限，且没有触发 API 限流。"+(message ? " "+message:""));
      if(response.status===404)throw new Error("未找到目标仓库或文件（404）。请确认 GitHub Token 已授权 ZZS-IPA-Store。");
      if(response.status===409)throw new Error("仓库内容发生冲突，请刷新页面后再提交。");
      if(response.status===422)throw new Error("GitHub 拒绝保存文件（422）："+message);
      throw new Error("GitHub API "+response.status+"："+(message||"请求失败"));
    }
    if(response.status===204)return {};
    return response.json();
  }
  async function loadSource({silent=false}={}) {
    try {
      const file=await request("/contents/"+SOURCE_PATH+"?ref="+BRANCH);
      const source=JSON.parse(decodeBase64(file.content));
      if(!source||!Array.isArray(source.apps)||!Array.isArray(source.news))throw new Error("source.json 不是有效的 AltStore 软件源");
      state.source=source;state.sha=file.sha;
      render(); populateSettings();
      if(!silent)toast("已读取最新软件源");
      $("syncStatus").textContent="软件源读取成功";
    } catch(e) {
      $("syncStatus").textContent="读取失败";
      if(!silent)toast(friendlyError(e),true);
      if(!state.source)render();
      throw e;
    }
  }
  function connectedUI() {
    const yes=!!state.token;
    $("authBtn").textContent=yes?"已连接 GitHub":"连接 GitHub";
    $("authBtn").disabled=yes;
    $("logoutBtn").hidden=!yes;
    $("onlineLight").classList.toggle("connected",yes);
    $("onlineLabel").textContent=yes?"GitHub 已连接":"只读模式";
    $("authState").textContent=yes?"已连接":"未连接";
    $("authState").style.color=yes?"#32a784":"#5f6885";
  }
  function ensureConnected() {if(state.busy){toast("操作进行中",true);return false;}if(!state.token){$("authDialog").showModal();return false;}return true;}
  async function connect(evt) {
    evt.preventDefault();
    const candidate=$("token").value.trim();
    if(!candidate){toast("请输入 GitHub Token",true);return;}
    const btn=$("authForm").querySelector("button[type=submit]");
    btn.disabled=true;btn.textContent="验证中…";
    state.token=candidate;
    try {
      const meta=await request("");
      if(meta.full_name !== REPO)throw new Error("GitHub 仓库名称不匹配");
      if(meta.permissions && meta.permissions.push === false)throw new Error("此 Token 只能读取仓库，缺少写入权限。请将 Contents 设置为 Read and write。");
      await loadSource({silent:true});
      $("token").value="";$("tokenConfirm").checked=false;
      $("authDialog").close();connectedUI();toast("已连接仓库："+REPO);
    }catch(e){state.token=null;connectedUI();toast(friendlyError(e),true);}
    finally{btn.disabled=false;btn.textContent="验证并连接";}
  }
  function logout(){state.token=null;state.file=null;$("ipaFile").value="";connectedUI();toast("已退出当前 GitHub 管理会话");}
  async function publish(data,message) {
    if(!state.sha)throw new Error("尚未获取软件源的 GitHub SHA，请先刷新");
    if(!data||!Array.isArray(data.apps)||!Array.isArray(data.news))throw new Error("软件源结构无效");
    const response=await request("/contents/"+SOURCE_PATH,{method:"PUT",body:{
      message,branch:BRANCH,sha:state.sha,content:toBase64(JSON.stringify(data,null,2)+"\n")
    }});
    state.sha=response.content.sha;state.source=data;render();populateSettings();
    $("syncStatus").textContent="刚刚保存，等待 Pages 更新";
  }
  async function uploadIPA(file,bundle,version,build) {
    if(!file||!/\.ipa$/i.test(file.name))throw new Error("请选择 .ipa 文件");
    if(file.size > MAX_UPLOAD_BYTES)throw new Error("IPA 超过 20 MiB，请在 GitHub Releases 发布后粘贴链接");
    if(file.size < 100)throw new Error("IPA 文件太小，可能无效");
    const filename=escSlug(version)+"-"+escSlug(build)+"-"+Date.now()+".ipa";
    const path=ROOT+"files/"+escSlug(bundle)+"/"+filename;
    const bytes=new Uint8Array(await file.arrayBuffer());
    const content=bytesToBase64(bytes);
    await request("/contents/"+path.split("/").map(encodeURIComponent).join("/"),{
      method:"PUT",body:{message:"Publish IPA "+bundle+" "+version+" ("+build+")",branch:BRANCH,content}
    });
    return "https://repo.zrh.jp/files/"+escSlug(bundle)+"/"+filename;
  }
  function showTab(tab) {
    if(!["dashboard","settings","guide"].includes(tab))return;
    state.selectedTab=tab;
    for(const name of ["dashboard","settings","guide"])$(name).hidden=name!==tab;
    for(const button of document.querySelectorAll(".sidebar button[data-tab]"))button.classList.toggle("active",button.dataset.tab===tab);
    $("pageTitle").textContent={dashboard:"应用管理",settings:"软件源设置",guide:"使用指南"}[tab];
  }
  function render() {
    const list=$("appList");list.replaceChildren();
    const apps=(state.source && state.source.apps)||[];
    $("appCount").textContent=apps.length;
    $("versionCount").textContent=apps.reduce((sum,app)=>sum+(Array.isArray(app.versions)?app.versions.length:0),0);
    if(!apps.length) {
      const empty=node("div","empty");
      empty.append(node("div","illustration","◇"),node("h3","",state.source?"暂无发布应用":"尚未加载软件源"),node("p","",state.source?"连接 GitHub 后，点击“添加应用 / IPA”即可发布第一个版本。":"请检查仓库 Pages 部署状态，或点击右上角刷新。"));
      list.append(empty);return;
    }
    for(const app of apps) {
      const versions=Array.isArray(app.versions)?app.versions:[];
      const outer=node("article","app-row"),top=node("div","app-top"),icon=node("img","app-icon");
      icon.alt="";icon.loading="lazy";icon.src=safeHTTPS(app.iconURL)||"../icon.svg";icon.addEventListener("error",()=>{icon.src="../icon.svg";},{once:true});
      const info=node("div","app-info");
      info.append(node("div","app-name",app.name||"未命名应用"),node("div","app-id",app.bundleIdentifier||""));
      top.append(icon,info,node("span","chip",versions.length?"最新版本 "+versions[0].version:"暂无版本"));
      outer.append(top);
      const actions=node("div","row-actions");
      for(const [label,action] of [["＋ 添加版本","add-version"],["编辑资料","edit-app"],["删除应用","remove-app"]]){
        const button=node("button",action==="remove-app"?"danger":"",label);button.type="button";button.dataset.action=action;button.dataset.bundle=app.bundleIdentifier;actions.append(button);
      }
      outer.append(actions);
      if(versions.length) {
        const rows=node("div","version-list");
        versions.forEach((v,i)=>{
          const row=node("div","version-row"),info=node("div","version-info");
          info.append(node("strong","",(i===0?"★ 最新 · ":"")+"v"+v.version+" ("+v.buildVersion+") · "+(v.date||"日期未填写")+" · "+shortSize(v.size)));
          const url=safeHTTPS(v.downloadURL);if(url){const a=node("a","","查看 IPA ↗");a.href=url;a.target="_blank";a.rel="noopener noreferrer";info.append(a);}
          row.append(info);
          for(const [label,act] of [["编辑","edit-version"],["设为最新","latest-version"],["删除","remove-version"]]){
            if(act==="latest-version"&&i===0)continue;
            const b=node("button",act==="remove-version"?"danger":"",label);b.type="button";b.dataset.action=act;b.dataset.bundle=app.bundleIdentifier;b.dataset.index=String(i);row.append(b);
          }
          rows.append(row);
        });
        outer.append(rows);
      }
      list.append(outer);
    }
  }
  function populateSettings() {
    const s=state.source;if(!s)return;
    const f=$("settingsForm");
    for(const name of ["name","subtitle","description","website","iconURL"]){const ctrl=f.elements.namedItem(name);if(ctrl)ctrl.value=s[name]||"";}
    f.elements.namedItem("tintColor").value=/^#[a-fA-F0-9]{6}$/.test(s.tintColor||"")?s.tintColor:"#6559e8";
  }
  async function saveSettings(evt) {
    evt.preventDefault();if(!ensureConnected())return;
    const f=$("settingsForm"),copy=structuredClone(state.source);
    copy.name=f.elements.namedItem("name").value.trim();
    copy.subtitle=f.elements.namedItem("subtitle").value.trim();
    copy.description=f.elements.namedItem("description").value.trim();
    copy.website=safeURLOrThrow(f.elements.namedItem("website").value,"官网地址")||"https://repo.zrh.jp/";
    copy.iconURL=safeURLOrThrow(f.elements.namedItem("iconURL").value,"源图标")||DEFAULT_ICON;
    copy.tintColor=f.elements.namedItem("tintColor").value;
    if(!copy.name)throw new Error("请填写软件源名称");
    await busyAction(async()=>{await publish(copy,"Update ZZS IPA Store source settings");toast("软件源设置已保存");});
  }
  function getApp(bundle) {return state.source?.apps.find(a=>a.bundleIdentifier===bundle);}
  function value(id){return $(id).value.trim();}
  function setValue(id,v){$(id).value=v===undefined||v===null?"":String(v);}
  function toggleFields(id,visible) {
    const el=$(id);el.hidden=!visible;
    for(const control of el.querySelectorAll("input,textarea,select"))control.disabled=!visible;
  }
  function openEditor(mode="new-app",bundle=null,index=-1) {
    if(!ensureConnected())return;
    if(mode!=="new-app"&&!getApp(bundle)){toast("应用不存在，请刷新",true);return;}
    state.mode=mode;state.bundle=bundle;state.index=index;state.file=null;
    $("editorForm").reset();$("ipaFile").value="";$("fileInfo").textContent="尚未选择文件";inline("");
    const app=mode==="new-app"?null:getApp(bundle);
    toggleFields("appFields",mode==="new-app"||mode==="edit-app");
    toggleFields("releaseFields",mode!=="edit-app");
    const titles={"new-app":["NEW APP","添加应用与首个版本"],"edit-app":["EDIT APP","编辑应用资料"],"new-version":["NEW RELEASE","添加新版本 · "+(app?.name||"")],"edit-version":["EDIT RELEASE","编辑历史版本 · "+(app?.name||"")]};
    $("editModeLabel").textContent=titles[mode][0];$("editTitle").textContent=titles[mode][1];
    $("saveBtn").textContent=mode==="edit-app"?"保存应用资料":"保存并发布";
    const now=new Date();setValue("fieldDate",[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-"));
    setValue("fieldDeveloper","ZZS");setValue("fieldPrivacy","{}");setValue("fieldCategory","utilities");
    if(app) {
      setValue("fieldName",app.name);setValue("fieldBundle",app.bundleIdentifier);
      setValue("fieldDeveloper",app.developerName);setValue("fieldCategory",app.category||"other");
      setValue("fieldIcon",app.iconURL||"");setValue("fieldDescription",app.localizedDescription||"");
      setValue("fieldSubtitle",app.subtitle||"");
      setValue("fieldEntitlements",(app.appPermissions?.entitlements||[]).join("\n"));
      setValue("fieldPrivacy",JSON.stringify(app.appPermissions?.privacy||{},null,2));
      if(mode==="edit-app")$("permissionsDetails").open=true;
    }
    if(mode==="edit-version") {
      const v=app.versions[index];if(!v){toast("历史版本不存在",true);return;}
      setValue("fieldVersion",v.version);setValue("fieldBuild",v.buildVersion);setValue("fieldDate",v.date?.slice(0,10));
      setValue("fieldSize",v.size);setValue("fieldDownload",v.downloadURL);setValue("fieldNotes",v.localizedDescription);
      setValue("fieldMinOS",v.minOSVersion);setValue("fieldMaxOS",v.maxOSVersion);
    }
    $("editorDialog").showModal();
  }
  async function fileChanged() {
    const file=$("ipaFile").files[0];state.file=file||null;
    if(!file){$("fileInfo").textContent="尚未选择文件";return;}
    $("fileInfo").textContent=file.name+" · "+shortSize(file.size);
    if(file.size>MAX_UPLOAD_BYTES){state.file=null;$("ipaFile").value="";$("fileInfo").textContent="文件过大，已取消本地选择："+file.name;inline("此文件超过 20 MiB。请通过 GitHub Releases 上传，再在这里使用 HTTPS 下载链接。");return;}
    setValue("fieldSize",file.size);
    try {
      inline("正在从 IPA 读取 Info.plist …");
      const data=await window.ZZSIPA.inspect(file);
      if(state.file!==file)return;
      if(state.mode==="new-app") {
        setValue("fieldName",data.name||"未命名应用");
        setValue("fieldBundle",data.bundleIdentifier);
        if(Object.keys(data.privacy).length)setValue("fieldPrivacy",JSON.stringify(data.privacy,null,2));
        $("permissionsDetails").open=Object.keys(data.privacy).length>0;
      } else if(state.mode==="new-version"||state.mode==="edit-version") {
        if(data.bundleIdentifier!==state.bundle)throw new Error("IPA Bundle ID（"+data.bundleIdentifier+"）与选中应用（"+state.bundle+"）不一致");
      }
      setValue("fieldVersion",data.version);setValue("fieldBuild",data.buildVersion);
      if(data.minOSVersion)setValue("fieldMinOS",data.minOSVersion);
      inline("已读取 Info.plist 元数据。请核对签名 Entitlements，自动解析无法保证读取全部权限。");
    } catch(e) {
      inline("提示："+friendlyError(e)+"。你可以手动填写应用资料，但务必校验实际 Bundle ID、版本和权限。");
    }
  }
  function collectAppInfo(original) {
    const name=value("fieldName"),bundle=value("fieldBundle");
    if(!name)throw new Error("请输入应用名称");
    if(!/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(bundle))throw new Error("Bundle ID 格式不正确，示例 com.example.app");
    const developerName=value("fieldDeveloper")||"ZZS";
    const iconURL=safeURLOrThrow(value("fieldIcon"),"图标 URL")||DEFAULT_ICON;
    const category=value("fieldCategory");
    if(!CATEGORIES.has(category))throw new Error("应用分类无效");
    let privacy;
    try{privacy=JSON.parse(value("fieldPrivacy")||"{}");}catch{throw new Error("隐私权限必须是合法的 JSON 对象");}
    if(!privacy||Array.isArray(privacy)||typeof privacy!=="object")throw new Error("隐私权限 JSON 必须是一个对象");
    for(const [k,v] of Object.entries(privacy)){
      if(!/^NS[A-Za-z0-9]+UsageDescription$/.test(k)||typeof v!=="string")throw new Error("隐私权限必须使用 NS...UsageDescription 字符串键值");
    }
    const entitlements=[...new Set(value("fieldEntitlements").split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
    const app={...(original||{}),name,bundleIdentifier:bundle,developerName,
      subtitle:value("fieldSubtitle"),localizedDescription:value("fieldDescription")||name,
      iconURL,category,appPermissions:{entitlements,privacy}};
    if(!Array.isArray(app.versions))app.versions=[];
    return app;
  }
  function collectRelease(existing) {
    const version=value("fieldVersion"),buildVersion=value("fieldBuild"),date=value("fieldDate");
    const size=Number(value("fieldSize"));
    if(!version||!buildVersion||!date)throw new Error("版本号、Build 和发布日期不能为空");
    if(!Number.isSafeInteger(size)||size<=0)throw new Error("请输入准确的 IPA 文件字节数");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("发布日期必须是 YYYY-MM-DD");
    const downloadURL=value("fieldDownload");
    if(!state.file&&!downloadURL)throw new Error("请选择 IPA 文件，或者填写 HTTPS 下载链接");
    if(!state.file&&!safeHTTPS(downloadURL))throw new Error("IPA 下载链接必须是完整的 HTTPS URL");
    if(state.file&&state.file.size>MAX_UPLOAD_BYTES)throw new Error("本地上传上限为 20 MiB，请使用 GitHub Releases");
    if(state.file&&state.file.size!==size)throw new Error("文件字节数与选中的 IPA 不一致，请重新选择文件");
    const release={...(existing||{}),version,buildVersion,date,
      localizedDescription:value("fieldNotes"),size};
    if(!state.file)release.downloadURL=safeURLOrThrow(downloadURL,"IPA 下载链接");
    if(value("fieldMinOS"))release.minOSVersion=value("fieldMinOS");else delete release.minOSVersion;
    if(value("fieldMaxOS"))release.maxOSVersion=value("fieldMaxOS");else delete release.maxOSVersion;
    return release;
  }
  async function busyAction(callback) {
    if(state.busy)return;
    state.busy=true;
    const submit=$("saveBtn");submit.disabled=true;
    const initialText=submit.textContent;submit.textContent="保存中…";
    try{await callback();}
    catch(e){const message=friendlyError(e);toast(message,true);inline(message);}
    finally{state.busy=false;submit.disabled=false;submit.textContent=initialText;}
  }
  async function saveEditor(evt) {
    evt.preventDefault();if(!ensureConnected())return;
    const mode=state.mode;const original=getApp(state.bundle);
    const next=structuredClone(state.source);
    const at=next.apps.findIndex(a=>a.bundleIdentifier===state.bundle);
    let app,release=null;
    try {
      if(mode==="new-app") {
        app=collectAppInfo();if(next.apps.some(a=>a.bundleIdentifier===app.bundleIdentifier))throw new Error("此 Bundle ID 已经存在，请通过添加版本操作更新");
        release=collectRelease(null);
        app.versions.unshift(release);next.apps.push(app);
      } else if(mode==="edit-app") {
        if(at<0)throw new Error("目标应用已经不存在");
        app=collectAppInfo(original);
        if(next.apps.some((a,i)=>i!==at && a.bundleIdentifier===app.bundleIdentifier))throw new Error("修改后的 Bundle ID 已被其他应用使用");
        next.apps[at]=app;
      } else {
        if(at<0)throw new Error("目标应用已经不存在");
        app=next.apps[at];
        release=collectRelease(mode==="edit-version" ? app.versions[state.index] : null);
        if(app.versions.some((v,i)=>(mode!=="edit-version"||i!==state.index)&&v.version===release.version&&v.buildVersion===release.buildVersion))
          throw new Error("此版本号和 Build 号的组合已存在");
        if(mode==="new-version")app.versions.unshift(release);
        else {
          if(!app.versions[state.index])throw new Error("目标历史版本已经不存在");
          app.versions[state.index]=release;
        }
      }
    } catch(e){inline(friendlyError(e));return;}
    await busyAction(async()=>{
      if(release && state.file) {
        try{const parsed=await window.ZZSIPA.inspect(state.file);
          if(parsed.bundleIdentifier!==app.bundleIdentifier)throw new Error("IPA Bundle ID 不匹配（IPA: "+parsed.bundleIdentifier+"，表单: "+app.bundleIdentifier+"），已取消上传");
          if(parsed.version!==release.version||parsed.buildVersion!==release.buildVersion)throw new Error("IPA 版本与表单不匹配（IPA: "+parsed.version+" / "+parsed.buildVersion+"），已取消上传");
        }catch(e){
          if(/不匹配/.test(friendlyError(e)))throw e;
          if(!confirm("无法完整验证 IPA 元数据："+friendlyError(e)+"\n仍要使用手动填写的资料发布吗？"))return;
        }
        inline("正在向 GitHub 上传 IPA 文件。文件较大时可能需要一点时间。");
        release.downloadURL=await uploadIPA(state.file,app.bundleIdentifier,release.version,release.buildVersion);
      }
      inline("正在更新 source.json …");
      await publish(next,mode==="edit-app"?"Edit AltStore app details":"Publish AltStore app "+app.bundleIdentifier);
      $("editorDialog").close();state.file=null;$("ipaFile").value="";
      toast("发布成功！GitHub Pages 更新后将显示在网站和 AltStore 中。");
      showTab("dashboard");
    });
  }
  async function modifyApp(action,bundle,index) {
    if(!ensureConnected())return;
    if(["add-version","edit-app","edit-version"].includes(action)) {
      openEditor(action==="add-version"?"new-version":action,bundle,index);return;
    }
    const source=structuredClone(state.source),appIndex=source.apps.findIndex(a=>a.bundleIdentifier===bundle);
    if(appIndex<0){toast("应用不存在，请刷新",true);return;}
    const app=source.apps[appIndex];
    if(action==="remove-app") {
      if(!confirm("确定从软件源移除「"+app.name+"」及全部版本吗？\n已上传的 IPA 文件不会自动删除。"))return;
      source.apps.splice(appIndex,1);
    } else if(action==="remove-version") {
      if(!app.versions[index])return;
      if(!confirm("删除版本 "+app.versions[index].version+" 的软件源记录吗？\nIPA 文件不会自动删除。"))return;
      app.versions.splice(index,1);
      if(!app.versions.length)source.apps.splice(appIndex,1);
    } else if(action==="latest-version") {
      if(index<=0||!app.versions[index])return;
      app.versions.unshift(app.versions.splice(index,1)[0]);
    } else return;
    await busyAction(async()=>{
      await publish(source,"Manage AltStore app "+bundle+" ("+action+")");
      toast("软件源已更新");
    });
  }
  async function copySource() {
    try{await navigator.clipboard.writeText(SOURCE_URL);toast("软件源地址已复制");}
    catch{toast("请手动复制："+SOURCE_URL);}
  }
  function wire() {
    document.querySelectorAll(".sidebar button[data-tab]").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
    $("authBtn").addEventListener("click",()=>{$("authDialog").showModal();});
    $("logoutBtn").addEventListener("click",logout);
    $("authForm").addEventListener("submit",connect);
    $("refreshBtn").addEventListener("click",()=>{loadSource().catch(()=>{});});
    $("settingsForm").addEventListener("submit",evt=>{saveSettings(evt).catch(e=>toast(friendlyError(e),true));});
    $("addAppBtn").addEventListener("click",()=>openEditor("new-app"));
    $("addAppBtn2").addEventListener("click",()=>openEditor("new-app"));
    $("editorForm").addEventListener("submit",evt=>{saveEditor(evt).catch(e=>toast(friendlyError(e),true));});
    $("ipaFile").addEventListener("change",()=>fileChanged().catch(e=>inline(friendlyError(e))));
    $("copySource").addEventListener("click",copySource);
    $("appList").addEventListener("click",evt=>{
      const b=evt.target.closest("button[data-action]");
      if(b)modifyApp(b.dataset.action,b.dataset.bundle,Number(b.dataset.index||0)).catch(e=>toast(friendlyError(e),true));
    });
    document.querySelectorAll("button[data-close]").forEach(b=>b.addEventListener("click",()=>{const d=$(b.dataset.close);if(d instanceof HTMLDialogElement)d.close();}));
    for(const dialog of document.querySelectorAll("dialog"))dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
  }
  wire();connectedUI();showTab("dashboard");loadSource({silent:true}).catch(err=>{console.error("Could not load GitHub repository source",err);toast(friendlyError(err),true);});
})();