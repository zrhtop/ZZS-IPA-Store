"use strict";
import {inspectIPA} from "./ipa-reader.js";
import {readVault,createVault,saveVault,decryptVault,exportVault,importVault,clearVault,validateUsername,validatePassword} from "./vault.js";

const REPO = "zrhtop/ZZS-IPA-Store";
const API = "https://api.github.com";
const SOURCE_PATH = "docs/source.json";
const SOURCE_URL = "https://repo.zrh.jp/source.json";
const SITE_URL = "https://repo.zrh.jp/";
const DEFAULT_ICON = "https://avatars.githubusercontent.com/u/101614537?v=4";
const MAX_DIRECT_SIZE = 20 * 1024 * 1024;
const CATEGORIES = new Set(["developer","entertainment","games","lifestyle","other","photo-video","social","utilities"]);
const $ = id => document.getElementById(id);
const elem = (tag,cls,txt) => {const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;};
const val = id => $(id).value.trim();

let token = "";
let actor = "";
let source = {name:"ZZS IPA Store",apps:[],news:[]};
let sourceSHA = null;
let editor = {mode:"new",bundle:null,index:-1};
let inspected = null;
let scanning = false;
let busy = false;

function alertUser(msg,isError=false) {
  const n=$("notice");n.className=isError?"notice error":"notice";n.textContent=msg;n.hidden=false;
  clearTimeout(alertUser.timer);alertUser.timer=setTimeout(()=>{n.hidden=true;},isError?10000:6000);
}
function validURL(s,optional=false) {
  if(!s&&optional)return "";
  try {
    const u=new URL(s);
    if(u.protocol!=="https:"||u.username||u.password)throw Error();
    return u.href;
  } catch {throw new Error("请填写完整的 HTTPS 地址："+(s||"(空)"));}
}
function iconURL(s){try{return validURL(s);}catch{return DEFAULT_ICON;}}
function encode64(bytes) {
  const blocks=[];
  for(let p=0;p<bytes.length;p+=16384){
    let binary="";
    for(let j=p;j<Math.min(p+16384,bytes.length);j++)binary+=String.fromCharCode(bytes[j]);
    blocks.push(binary);
  }
  return btoa(blocks.join(""));
}
function decodeJSON(b64){
  const binary=atob(String(b64).replace(/\s/g,""));
  const b=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)b[i]=binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(b));
}
async function api(url,method="GET",body=undefined) {
  const headers={"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  if(token)headers.Authorization="Bearer "+token;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const r=await fetch(url,{method,headers,cache:"no-store",referrerPolicy:"no-referrer",body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await r.json().catch(()=>({}));
  if(!r.ok){
    const detail=String(payload.message||r.statusText||"请求失败").slice(0,400);
    throw new Error("GitHub HTTP "+r.status+"："+detail);
  }
  return payload;
}
function githubPath(p){return API+"/repos/"+REPO+"/contents/"+p.split("/").map(encodeURIComponent).join("/");}
async function getGithubSource(){
  const file=await api(githubPath(SOURCE_PATH)+"?ref=main");
  if(!file.sha||file.encoding!=="base64")throw new Error("无法获取 GitHub 软件源文件及版本 SHA。");
  return {data:decodeJSON(file.content),sha:file.sha};
}
async function putFile(path,bytes,message,sha=undefined){
  const request={branch:"main",message,content:encode64(bytes)};
  if(sha)request.sha=sha;
  return api(githubPath(path),"PUT",request);
}
async function ensureFresh(){
  const current=await getGithubSource();
  if(current.sha!==sourceSHA)throw new Error("软件源已被其他操作更新，请先刷新，不要覆盖他人的修改。");
}
async function saveSource(draft,message){
  await ensureFresh();
  const content=new TextEncoder().encode(JSON.stringify(draft,null,2)+"\n");
  const outcome=await putFile(SOURCE_PATH,content,message,sourceSHA);
  if(!outcome.content?.sha)throw new Error("GitHub 未返回新版本号，请刷新检查文件是否保存成功。");
  sourceSHA=outcome.content.sha;
  acceptSource(draft);
}
function acceptSource(data){
  if(!data||typeof data!=="object"||!Array.isArray(data.apps))throw new Error("source.json 必须包含 apps 数组。");
  if(!Array.isArray(data.news))data.news=[];
  source=data;render();populateSettings();
}
async function loadSource(){
  if(busy)return;
  $("repoStatus").textContent="正在加载";$("repoStatus").className="state-loading";
  try{
    if(token){
      const s=await getGithubSource();sourceSHA=s.sha;acceptSource(s.data);
    }else{
      const r=await fetch("../source.json?t="+Date.now(),{cache:"no-store"});
      if(!r.ok)throw new Error("HTTP "+r.status);
      acceptSource(await r.json());sourceSHA=null;
    }
    $("repoStatus").textContent=token?"GitHub 已连接":"公开可读";
    $("repoStatus").className="state-ok";
  }catch(e){
    $("repoStatus").textContent="读取失败";$("repoStatus").className="state-error";
    alertUser("读取软件源失败："+e.message,true);
  }
}
function authMessage(message,success=false){
  const notice=$("authMessage");
  notice.textContent=message;
  notice.className=success?"auth-alert ok":"auth-alert";
  notice.hidden=false;
}
function setAuthUI(){
  const authenticated=!!token;
  $("appLayout").hidden=!authenticated;
  $("authPanel").hidden=authenticated;
  $("identityPanel").hidden=!authenticated;
  $("connectionText").textContent=authenticated?"GitHub 已验证":"尚未登录";
  $("connectionDot").classList.toggle("online",authenticated);
  $("accountName").textContent=actor||"管理员";
  if(!authenticated){
    let vault=null;
    try{vault=readVault();}
    catch(e){authMessage(e.message);}
    $("setupView").hidden=!!vault;
    $("loginView").hidden=!vault;
    if(vault)$("loginUsername").value=vault.username;
    if($("loginView").hidden && !vault)$("setupUsername").value="zzsadmin";
    $("loginPassword").value="";
  }
  render();
}
async function verifyGitHubAccess(){
  const [current,repo]=await Promise.all([
    getGithubSource(),
    api(API+"/repos/"+REPO)
  ]);
  if(repo.full_name!==REPO)throw new Error("GitHub 仓库验证失败。");
  if(repo.permissions?.push===false)throw new Error("Token 对该仓库没有写入权限。请创建具有 Contents: Read and write 权限的 Fine-grained Token。");
  return current;
}
async function setupAccount(event){
  event.preventDefault();
  if(busy)return;
  const username=val("setupUsername"),password=$("setupPassword").value;
  const confirmation=$("setupConfirm").value,candidate=val("setupToken");
  let encrypted;
  try{
    validateUsername(username);
    validatePassword(password,username);
    if(password!==confirmation)throw new Error("两次输入的密码不一致。");
    if(readVault())throw new Error("本机已经设置过账户，请先登录或重置账户。");
    if(!candidate)throw new Error("请输入 GitHub 访问令牌。");
    busy=true;$("setupBtn").disabled=true;$("setupBtn").textContent="正在验证 GitHub…";
    token=candidate;
    const current=await verifyGitHubAccess();
    encrypted=await createVault(username,password,token);
    saveVault(encrypted);
    actor=username;sourceSHA=current.sha;acceptSource(current.data);
    $("setupPassword").value="";$("setupConfirm").value="";$("setupToken").value="";
    setAuthUI();
    $("repoStatus").textContent="GitHub 已连接";
    $("repoStatus").className="state-ok";
    alertUser("管理员账户已加密保存在此浏览器，可以开始管理 IPA。");
  }catch(e){
    token="";actor="";sourceSHA=null;
    setAuthUI();
    authMessage("设置失败："+e.message);
  }finally{busy=false;$("setupBtn").disabled=false;$("setupBtn").textContent="创建本机账户并进入后台 →";}
}
async function loginAccount(event){
  event.preventDefault();
  if(busy)return;
  busy=true;$("loginBtn").disabled=true;$("loginBtn").textContent="正在解锁…";
  try{
    const vault=readVault();
    if(!vault)throw new Error("当前浏览器尚未配置管理员账户。");
    const username=val("loginUsername"),password=$("loginPassword").value;
    const candidate=await decryptVault(vault,username,password);
    token=candidate;
    const current=await verifyGitHubAccess();
    actor=username;sourceSHA=current.sha;acceptSource(current.data);
    $("loginPassword").value="";
    setAuthUI();
    $("repoStatus").textContent="GitHub 已连接";
    $("repoStatus").className="state-ok";
    alertUser("登录成功。");
  }catch(e){
    token="";actor="";sourceSHA=null;
    setAuthUI();
    authMessage("登录失败："+e.message+"。如 Token 过期，可使用下方的重新绑定功能。");
  }finally{busy=false;$("loginBtn").disabled=false;$("loginBtn").textContent="解锁并登录 →";}
}
function disconnect(){
  token="";actor="";sourceSHA=null;inspected=null;
  $("editor").open&&$("editor").close();
  $("accountDialog").open&&$("accountDialog").close();
  setAuthUI();
  authMessage("已退出登录。加密账户仍保存在本浏览器。",true);
}
function authorized(){
  if(token)return true;
  setAuthUI();authMessage("请先登录管理员账户。");
  return false;
}
function openAccountSettings(){
  if(!authorized())return;
  const vault=readVault();
  $("accountForm").reset();
  $("accountNewUsername").value=vault.username;
  $("accountDialog").showModal();
}
async function saveAccountSettings(event){
  event.preventDefault();
  if(busy)return;
  const oldPass=$("accountCurrentPassword").value;
  const username=val("accountNewUsername");
  const newPass=$("accountNewPassword").value;
  const repeat=$("accountConfirmPassword").value;
  busy=true;$("saveAccountBtn").disabled=true;
  try{
    const vault=readVault();
    const recovered=await decryptVault(vault,vault.username,oldPass);
    if(recovered!==token)throw new Error("当前会话的 GitHub Token 已发生变化，请重新登录。");
    validateUsername(username);
    validatePassword(newPass,username);
    if(newPass!==repeat)throw new Error("两次输入的新密码不一致。");
    if(newPass===oldPass && username===vault.username)throw new Error("请修改用户名或密码。");
    const updated=await createVault(username,newPass,token);
    saveVault(updated);
    $("accountForm").reset();
    $("accountDialog").close();
    disconnect();
    authMessage("账号或密码已更新，请使用新凭据登录。",true);
  }catch(e){alertUser("修改失败："+e.message,true);}
  finally{busy=false;$("saveAccountBtn").disabled=false;}
}
function resetAccount(){
  if(!confirm("确定清除这台设备的管理员配置吗？\n这会删除本地保存的加密 GitHub Token，仓库里的应用不会删除。\n重置后需要再次输入一个有效 GitHub Token。"))return;
  clearVault();
  disconnect();
  authMessage("已清除本机账户，请重新创建账号和绑定 GitHub Token。",true);
}
async function importAccount(event){
  const file=event.target.files?.[0];
  event.target.value="";
  if(!file)return;
  try{
    const imported=await importVault(file);
    if(readVault()&&!confirm("本机已配置账户。确定用导入的账户备份替换它吗？"))return;
    saveVault(imported);
    disconnect();
    $("loginUsername").value=imported.username;
    authMessage("导入成功，请输入该加密备份的原密码登录。",true);
  }catch(e){authMessage("导入失败："+e.message);}
}
function downloadAccountBackup(){
  try{
    const blob=exportVault();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="zzs-admin-encrypted-backup.json";
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
    alertUser("已生成加密账户备份，请妥善保管。");
  }catch(e){alertUser(e.message,true);}
}
function getApp(bundle){return source.apps.find(a=>a.bundleIdentifier===bundle);}
function button(title,cb,danger=false) {
  const n=elem("button",danger?"small-btn critical":"small-btn",title);
  n.type="button";n.disabled=!token||busy;n.addEventListener("click",cb);return n;
}
function render(){
  $("appCount").textContent=source.apps.length;
  $("versionCount").textContent=source.apps.reduce((n,a)=>n+(Array.isArray(a.versions)?a.versions.length:0),0);
  const root=$("appList");root.replaceChildren();
  const q=val("appSearch").toLowerCase();
  const filtered=source.apps.filter(a=>((a.name||"")+" "+(a.bundleIdentifier||"")).toLowerCase().includes(q));
  if(!filtered.length){
    const box=elem("div","empty");
    box.append(elem("div","empty-symbol","◇"),elem("strong","",q?"没有搜索结果":"尚未发布应用"),elem("p","",q?"试试其他关键词。":"连接 GitHub 后点击「添加应用」即可发布第一款 IPA。"));
    root.append(box);return;
  }
  for(const app of filtered){
    const versions=Array.isArray(app.versions)?app.versions:[];
    const outer=elem("article","app-item"),main=elem("div","app-main"),image=elem("img","app-icon");
    image.alt="";image.loading="lazy";image.src=iconURL(app.iconURL);
    image.addEventListener("error",()=>{image.src=DEFAULT_ICON;},{once:true});
    const info=elem("div","app-meta");
    info.append(elem("b","",app.name||"未命名"),elem("span","",app.bundleIdentifier||""));
    const v=versions[0];
    const actions=elem("div","row-buttons");
    actions.append(
      button("＋ 新版本",()=>openEditor("version",app.bundleIdentifier)),
      button("编辑",()=>openEditor("edit-app",app.bundleIdentifier)),
      button("删除",()=>removeApp(app.bundleIdentifier),true)
    );
    main.append(image,info,elem("span","version-tag",v?"v"+v.version+" · Build "+v.buildVersion:"无版本"),actions);
    outer.append(main);
    if(versions.length){
      const detail=elem("details","history");
      detail.append(elem("summary","", "版本历史（"+versions.length+"）"));
      versions.forEach((entry,index)=>{
        const line=elem("div","history-row");
        line.append(elem("span","release-name",(index===0?"最新版 · ":"")+"v"+entry.version+" ("+entry.buildVersion+") · "+(entry.date||"")));
        try{
          const a=elem("a","","IPA ↗");a.href=validURL(entry.downloadURL);a.target="_blank";a.rel="noopener noreferrer";line.append(a);
        }catch{}
        line.append(
          button("编辑",()=>openEditor("edit-version",app.bundleIdentifier,index)),
          button("设为最新",()=>promoteVersion(app.bundleIdentifier,index)),
          button("删除",()=>removeVersion(app.bundleIdentifier,index),true)
        );
        detail.append(line);
      });
      outer.append(detail);
    }
    root.append(outer);
  }
}
function populateSettings(){
  const form=$("settingsForm");
  for(const key of ["name","subtitle","description","website","iconURL","tintColor"]){
    const field=form.elements.namedItem(key);
    if(field)field.value=source[key]||(key==="tintColor"?"#6559e8":"");
  }
}
async function mutate(change,message){
  if(!authorized()||busy)return;
  busy=true;
  try{
    await ensureFresh();
    const draft=structuredClone(source);
    change(draft);
    await saveSource(draft,message);
    alertUser("修改已保存。GitHub Pages 可能需要短暂时间刷新。");
  }catch(e){alertUser(e.message,true);}
  finally{busy=false;render();}
}
function removeApp(bundle){
  const app=getApp(bundle);
  if(!app||!authorized()||!confirm("确定下架「"+app.name+"」及其全部历史版本吗？\n已上传的 IPA 文件不会自动删除。"))return;
  mutate(d=>{d.apps=d.apps.filter(a=>a.bundleIdentifier!==bundle);},"Remove app "+bundle);
}
function removeVersion(bundle,index){
  const a=getApp(bundle),v=a?.versions?.[index];
  if(!v||!authorized()||!confirm("删除版本 v"+v.version+" 的软件源记录？\nIPA 文件不会自动删除。"))return;
  mutate(d=>{
    const app=d.apps.find(a=>a.bundleIdentifier===bundle);
    app.versions.splice(index,1);
    if(!app.versions.length)d.apps=d.apps.filter(a=>a.bundleIdentifier!==bundle);
  },"Remove release "+bundle+" "+v.version);
}
function promoteVersion(bundle,index){
  if(index===0)return alertUser("这个版本已经是最新版。");
  if(!authorized()||!getApp(bundle)?.versions?.[index])return;
  const v=getApp(bundle).versions[index];
  if(!confirm("将版本 v"+v.version+" 设置成最新版？AltStore 根据版本列表第一项判断更新。"))return;
  mutate(d=>{
    const versions=d.apps.find(a=>a.bundleIdentifier===bundle).versions;
    versions.unshift(versions.splice(index,1)[0]);
  },"Promote release "+bundle+" "+v.version);
}
async function saveSettings(evt){
  evt.preventDefault();if(!authorized()||busy)return;
  const f=$("settingsForm");
  if(!f.reportValidity())return;
  busy=true;
  try{
    const next={...source,
      name:f.elements.namedItem("name").value.trim(),
      subtitle:f.elements.namedItem("subtitle").value.trim(),
      description:f.elements.namedItem("description").value.trim(),
      website:validURL(f.elements.namedItem("website").value.trim(),true),
      iconURL:validURL(f.elements.namedItem("iconURL").value.trim(),true),
      tintColor:f.elements.namedItem("tintColor").value
    };
    await saveSource(next,"Update ZZS IPA Store settings");
    alertUser("软件源设置已保存。");
  }catch(e){alertUser(e.message,true);}
  finally{busy=false;}
}
function openEditor(mode="new",bundle=null,index=-1){
  if(!authorized()||busy)return;
  editor={mode,bundle,index};inspected=null;
  const form=$("editorForm");form.reset();$("ipaFile").value="";
  $("ipaResult").textContent="选择 IPA 后会自动尝试读取应用名称、Bundle ID、版本号、图标和隐私权限。";
  $("ipaResult").style.whiteSpace="pre-line";
  const now=new Date();
  $("releaseDate").value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
  $("privacy").value="{}";$("entitlements").value="";$("appTint").value="#6559e8";
  const app=bundle?getApp(bundle):null;
  const release=app&&index>=0?app.versions?.[index]:null;
  const labels={
    new:["NEW APPLICATION","发布 IPA 应用","上传并发布"],
    version:["NEW RELEASE","发布新版本","发布新版本"],
    "edit-app":["EDIT APPLICATION","编辑应用信息","保存应用资料"],
    "edit-version":["EDIT VERSION","编辑历史版本","保存版本记录"]
  };
  $("editorEyebrow").textContent=labels[mode][0];$("editorTitle").textContent=labels[mode][1];$("saveEditor").textContent=labels[mode][2];
  $("appFields").hidden=mode==="version"||mode==="edit-version";
  $("releaseFields").hidden=mode==="edit-app";
  $("permissionsFields").hidden=mode==="edit-app";
  if(app){
    $("appName").value=app.name||"";$("bundleID").value=app.bundleIdentifier||"";
    $("developer").value=app.developerName||"ZZS";
    $("category").value=CATEGORIES.has(app.category)?app.category:"other";
    $("appSubtitle").value=app.subtitle||"";$("description").value=app.localizedDescription||"";
    $("iconURL").value=app.iconURL||"";
    $("appTint").value=/^#[0-9a-f]{6}$/i.test(app.tintColor||"")?app.tintColor:"#6559e8";
    $("entitlements").value=(app.appPermissions?.entitlements||[]).join("\n");
    $("privacy").value=JSON.stringify(app.appPermissions?.privacy||{},null,2);
  }
  if(release){
    $("downloadURL").value=release.downloadURL||"";
    $("version").value=release.version||"";
    $("buildVersion").value=release.buildVersion||"";
    $("releaseDate").value=(release.date||"").slice(0,10);
    $("size").value=release.size||"";
    $("releaseNotes").value=release.localizedDescription||"";
    $("minOS").value=release.minOSVersion||"";
    $("maxOS").value=release.maxOSVersion||"";
  }
  $("editor").showModal();
}
function closeEditor(){if(!busy)$("editor").close();}
async function parseSelection(file){
  inspected=null;
  if(!file)return;
  $("ipaResult").textContent="正在读取 IPA Info.plist…";scanning=true;
  try{
    if(file.size>MAX_DIRECT_SIZE){
      $("ipaResult").textContent="文件为 "+(file.size/1048576).toFixed(1)+" MiB，超过 20 MiB 网页上传上限。请使用 GitHub Releases 并清除本地文件选择。";
      return;
    }
    const data=await inspectIPA(file);
    if($("ipaFile").files[0]!==file)return;
    inspected=data;
    if(editor.mode==="new"){
      if(data.name)$("appName").value=data.name;
      if(data.bundleID)$("bundleID").value=data.bundleID;
    }
    if(data.version)$("version").value=data.version;
    if(data.buildVersion)$("buildVersion").value=data.buildVersion;
    if(data.minOSVersion)$("minOS").value=data.minOSVersion;
    $("size").value=file.size;
    $("privacy").value=JSON.stringify(data.privacy,null,2);
    $("entitlements").value=data.entitlements.join("\n");
    $("ipaResult").textContent=[
      "✓ 已识别："+data.name+" · "+(data.bundleID||"未知 Bundle ID"),
      "v"+(data.version||"?")+" (Build "+(data.buildVersion||"?")+") · "+(file.size/1048576).toFixed(2)+" MiB",
      data.iconBytes?"已发现 PNG 应用图标。":"没有提取到独立 PNG 图标。",
      ...data.warnings
    ].join("\n");
  }catch(e){
    $("ipaResult").textContent="自动解析失败："+e.message+"。仍可手动填写信息，但请仔细核对 Bundle ID、版本和权限。";
  }finally{scanning=false;}
}
function permissions(){
  let privacy;
  try{privacy=JSON.parse(val("privacy")||"{}");}catch{throw new Error("Privacy 必须是有效 JSON 对象。");}
  if(!privacy||Array.isArray(privacy)||typeof privacy!=="object")throw new Error("Privacy 必须是 JSON 对象。");
  for(const [k,v] of Object.entries(privacy))if(!k.endsWith("UsageDescription")||typeof v!=="string")throw new Error("Privacy 应包含 UsageDescription 字符串键值。");
  const entitlements=[...new Set($("entitlements").value.split(/[\r\n,]+/).map(s=>s.trim()).filter(Boolean))];
  return {entitlements,privacy};
}
function newApp(versions=[]){
  const name=val("appName"),bundleIdentifier=val("bundleID"),developerName=val("developer"),description=val("description");
  if(!name||!bundleIdentifier||!developerName||!description)throw new Error("请填写应用名称、Bundle ID、开发者和详细描述。");
  if(!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(bundleIdentifier))throw new Error("Bundle ID 格式错误，示例 com.example.app。");
  return {
    name,bundleIdentifier,developerName,
    subtitle:val("appSubtitle"),localizedDescription:description,
    iconURL:validURL(val("iconURL"),true)||DEFAULT_ICON,
    tintColor:$("appTint").value,
    category:CATEGORIES.has($("category").value)?$("category").value:"other",
    versions,appPermissions:permissions()
  };
}
function newRelease(download,size){
  const version=val("version"),buildVersion=val("buildVersion");
  if(!version||!buildVersion)throw new Error("必须填写版本号和 Build Version。");
  if(!Number.isSafeInteger(size)||size<1)throw new Error("IPA 大小必须是准确的字节数。");
  return {
    version,buildVersion,date:val("releaseDate")||new Date().toISOString().slice(0,10),
    localizedDescription:val("releaseNotes"),
    downloadURL:validURL(download),size,
    ...(val("minOS")?{minOSVersion:val("minOS")}:{}),
    ...(val("maxOS")?{maxOSVersion:val("maxOS")}:{}),
  };
}
function slug(s){return String(s).replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,90)||"app";}
async function uploadIPA(file,bundle,version,build){
  const filename=slug(bundle)+"-"+slug(version)+"-"+slug(build)+"-"+Date.now()+".ipa";
  await putFile("docs/ipas/"+filename,new Uint8Array(await file.arrayBuffer()),"Upload "+filename);
  return SITE_URL+"ipas/"+encodeURIComponent(filename);
}
async function uploadIcon(bundle){
  if(!inspected?.iconBytes)return null;
  const filename=slug(bundle)+"-"+Date.now()+".png";
  await putFile("docs/icons/"+filename,inspected.iconBytes,"Add icon "+filename);
  return SITE_URL+"icons/"+encodeURIComponent(filename);
}
async function saveEditor(evt){
  evt.preventDefault();if(!authorized()||busy||scanning)return;
  const mode=editor.mode,bundle=editor.bundle,index=editor.index,file=$("ipaFile").files[0]||null;
  if(file&&file.size>MAX_DIRECT_SIZE)return alertUser("IPA 超过 20 MiB。请先上传到 Releases，清空文件选项后使用下载链接。",true);
  busy=true;$("saveEditor").disabled=true;$("saveEditor").textContent="正在保存…";
  try{
    await ensureFresh();
    const draft=structuredClone(source);
    const app=bundle?draft.apps.find(a=>a.bundleIdentifier===bundle):null;
    if(bundle&&!app)throw new Error("目标应用不存在，请刷新。");
    if(mode==="edit-app"){
      const next=newApp(app.versions);
      if(next.bundleIdentifier!==bundle)throw new Error("已发布应用的 Bundle ID 不能直接修改。请创建新应用，以免历史 IPA 标识不一致。");
      Object.assign(app,next);
    }else{
      const target=mode==="new"?newApp([]):app;
      if(mode==="new"&&draft.apps.some(a=>a.bundleIdentifier===target.bundleIdentifier))throw new Error("相同 Bundle ID 已存在，请使用「新版本」。");
      if(file&&inspected?.bundleID&&inspected.bundleID!==target.bundleIdentifier)throw new Error("IPA 内的 Bundle ID 与目标应用不一致。");
      let url=val("downloadURL");
      if(!file&&!url)throw new Error("请选择 IPA 文件，或填写可公开下载的 IPA HTTPS 链接。");
      const size=file?file.size:Number(val("size"));
      const release=newRelease(file?SITE_URL+"ipas/pending.ipa":url,size);
      if(mode==="edit-version"){
        if(!target.versions?.[index])throw new Error("找不到原版本记录。");
        if(target.versions.some((v,i)=>i!==index&&v.version===release.version&&v.buildVersion===release.buildVersion))throw new Error("版本号和 Build Version 与已有记录重复。");
      }else if(target.versions.some(v=>v.version===release.version&&v.buildVersion===release.buildVersion))throw new Error("此版本号与 Build Version 已存在。");
      target.appPermissions=permissions();
      if(file){
        alertUser("正在上传 IPA 文件，请不要关闭此页面。");
        release.downloadURL=await uploadIPA(file,target.bundleIdentifier,release.version,release.buildVersion);
      }
      if(mode==="edit-version")target.versions[index]=release;
      else target.versions.unshift(release);
      if(mode==="new"){
        if(file&&inspected?.iconBytes&&!val("iconURL")){
          const extracted=await uploadIcon(target.bundleIdentifier);
          if(extracted)target.iconURL=extracted;
        }
        draft.apps.unshift(target);
      }
    }
    await saveSource(draft,"Update ZZS IPA Store "+(mode==="new"?val("bundleID"):bundle));
    $("editor").close();
    alertUser("提交成功，GitHub Pages 更新后会在 AltStore 中显示。");
  }catch(e){
    alertUser("保存失败："+e.message+"。若 IPA 已上传而 JSON 更新失败，可能留下未关联的文件。",true);
  }finally{
    busy=false;$("saveEditor").disabled=false;
    $("saveEditor").textContent={new:"上传并发布",version:"发布新版本","edit-app":"保存应用资料","edit-version":"保存版本记录"}[mode];render();
  }
}
function tab(name){
  const titles={overview:["应用管理","上传 IPA、管理版本，实时维护 AltStore Classic 软件源。"],settings:["软件源设置","修改商店名称、介绍与主题。"],guide:["部署与帮助","GitHub Pages、DNS 和令牌授权说明。"]};
  if(!titles[name])return;
  for(const key of Object.keys(titles))$("view-"+key).hidden=key!==name;
  document.querySelectorAll(".menu-item[data-view]").forEach(b=>b.classList.toggle("selected",b.dataset.view===name));
  $("pageTitle").textContent=titles[name][0];$("pageSubtitle").textContent=titles[name][1];
  location.hash=name==="overview"?"":name;
}
async function copyURL(){
  try{await navigator.clipboard.writeText(SOURCE_URL);alertUser("软件源地址已复制。");}
  catch{alertUser("请手动复制："+SOURCE_URL);}
}
function backup(){
  const file=new Blob([JSON.stringify(source,null,2)+"\n"],{type:"application/json"});
  const url=URL.createObjectURL(file);
  const a=document.createElement("a");a.href=url;a.download="zzs-source-"+new Date().toISOString().slice(0,10)+".json";document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("setupForm").addEventListener("submit",setupAccount);
$("loginForm").addEventListener("submit",loginAccount);
$("disconnectBtn").addEventListener("click",disconnect);
$("accountSettingsBtn").addEventListener("click",openAccountSettings);
$("guideAccountBtn").addEventListener("click",openAccountSettings);
$("accountForm").addEventListener("submit",saveAccountSettings);
$("closeAccountBtn").addEventListener("click",()=>!busy&&$("accountDialog").close());
$("cancelAccountBtn").addEventListener("click",()=>!busy&&$("accountDialog").close());
$("resetVaultBtn").addEventListener("click",resetAccount);
$("forgotBtn").addEventListener("click",resetAccount);
$("exportVaultBtn").addEventListener("click",downloadAccountBackup);
$("importVaultBtn").addEventListener("click",()=>$("importVaultFile").click());
$("importVaultFile").addEventListener("change",importAccount);
$("refreshBtn").addEventListener("click",loadSource);
for(const id of ["newAppBtn","heroNew","listNew"])$(id).addEventListener("click",()=>openEditor());
$("appSearch").addEventListener("input",render);
$("settingsForm").addEventListener("submit",saveSettings);
$("copySource").addEventListener("click",copyURL);
$("downloadJSON").addEventListener("click",backup);
$("editorForm").addEventListener("submit",saveEditor);
$("closeEditor").addEventListener("click",closeEditor);
$("cancelEditor").addEventListener("click",closeEditor);
$("editor").addEventListener("cancel",e=>{if(busy)e.preventDefault();});
$("ipaFile").addEventListener("change",e=>parseSelection(e.target.files[0]));
$("dropZone").addEventListener("dragover",e=>{e.preventDefault();$("dropZone").classList.add("dragging");});
$("dropZone").addEventListener("dragleave",()=>$("dropZone").classList.remove("dragging"));
$("dropZone").addEventListener("drop",e=>{
  e.preventDefault();$("dropZone").classList.remove("dragging");
  const file=e.dataTransfer?.files?.[0];if(!file)return;
  const list=new DataTransfer();list.items.add(file);$("ipaFile").files=list.files;parseSelection(file);
});
document.querySelectorAll(".menu-item[data-view]").forEach(b=>b.addEventListener("click",()=>tab(b.dataset.view)));
tab(location.hash.replace("#","")||"overview");
setAuthUI();
