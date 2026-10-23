"use strict";

// ZZS IPA Store admin gateway. GitHub Pages NEVER serves these admin assets.
// The bootstrap credentials are stored only as a salted PBKDF2 hash.
// Change the first-login password immediately in /admin/change.
const USER = "zzsadmin";
const BOOTSTRAP_SALT = "IjRaFDWcNlXLOxHrTmwfNQ==";
const BOOTSTRAP_HASH = "KI3vYIFXd4isN4o5nVaXJNOw+wHN6GLy/POY5zkIEDY=";
const ITERATIONS = 240000;
const COOKIE = "__Secure-zzs_session";
const SESSION_LIFETIME = 12 * 60 * 60;
const GH_REPO = "zrhtop/ZZS-IPA-Store";
const GH_ROOT = "https://api.github.com/repos/" + GH_REPO + "/contents/";
const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);

function resp(text,status=200,headers={}) {
  return new Response(text,{
    status,
    headers:{
      "Content-Type":"text/plain; charset=utf-8",
      "Cache-Control":"private, no-store, max-age=0",
      "X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"no-referrer",
      "X-Robots-Tag":"noindex, nofollow",
      "Cross-Origin-Resource-Policy":"same-origin",
      ...headers
    }
  });
}
function json(value,status=200) {
  return resp(JSON.stringify(value),status,{"Content-Type":"application/json; charset=utf-8"});
}
function escapeHTML(input) {
  return String(input).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function encodeBase64(bytes) {
  let output="";
  for(let i=0;i<bytes.length;i+=8192) output+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(output);
}
function decodeBase64(b64) {
  return Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0));
}
function randomBase64(size=32) {
  const bytes=crypto.getRandomValues(new Uint8Array(size));
  return encodeBase64(bytes).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
}
async function hashText(text) {
  const data=await crypto.subtle.digest("SHA-256",encoder.encode(text));
  return encodeBase64(new Uint8Array(data));
}
async function passwordHash(password,salt,iterations=ITERATIONS) {
  const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const derived=await crypto.subtle.deriveBits(
    {name:"PBKDF2",salt:decodeBase64(salt),iterations,hash:"SHA-256"},
    key,256
  );
  return encodeBase64(new Uint8Array(derived));
}
function constantEqual(a,b) {
  const aa=encoder.encode(a),bb=encoder.encode(b);
  let diff=aa.length ^ bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++) diff|=(aa[i]||0)^(bb[i]||0);
  return diff===0;
}
async function verify(password,user) {
  return constantEqual(await passwordHash(password,user.salt,user.iterations),user.password_hash);
}
async function seedDB(db) {
  await db.prepare(
    "INSERT OR IGNORE INTO admin_account (id,username,salt,password_hash,iterations,must_change,updated_at) VALUES (1,?,?,?,?,1,?)"
  ).bind(USER,BOOTSTRAP_SALT,BOOTSTRAP_HASH,ITERATIONS,now()).run();
}
async function currentUser(db) {
  return db.prepare("SELECT id,username,salt,password_hash,iterations,must_change FROM admin_account WHERE id=1").first();
}
function getCookie(request) {
  const cookies=request.headers.get("cookie")||"";
  const found=cookies.split(";").map(s=>s.trim()).find(s=>s.startsWith(COOKIE+"="));
  if(!found)return "";
  return found.slice(COOKIE.length+1);
}
async function getSession(request,db) {
  const value=getCookie(request);
  if(!value || !/^[A-Za-z0-9_-]{43}$/.test(value))return null;
  const digest=await hashText(value);
  return db.prepare(
    "SELECT s.token_hash,s.expires_at,u.username,u.must_change FROM auth_sessions s JOIN admin_account u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(digest,now()).first();
}
function cookieHeader(token) {
  return COOKIE+"="+token+"; HttpOnly; Secure; SameSite=Strict; Path=/admin/; Max-Age="+SESSION_LIFETIME;
}
function clearCookie() {
  return COOKIE+"=; HttpOnly; Secure; SameSite=Strict; Path=/admin/; Max-Age=0";
}
function redirect(path,cookie) {
  return resp(null,303,{"Location":path,...(cookie?{"Set-Cookie":cookie}:{})});
}
function validOrigin(request) {
  const url=new URL(request.url);
  return request.headers.get("Origin")===url.origin;
}
function unauthorized() {return json({error:"未登录或登录已过期。"},401);}
function deny() {return resp("Forbidden",403);}
function htmlPage(title,body,status=200) {
  const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#111a32"><title>'+
  escapeHTML(title)+' · ZZS IPA Store</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 15%,#dedfff,transparent 42%),#f6f7fc;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#27304b;min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(100%,450px);background:white;border:1px solid #e4e7f2;border-radius:20px;padding:36px;box-shadow:0 20px 70px #19214713}.brand{display:flex;align-items:center;gap:13px;margin-bottom:30px}.logo{display:grid;place-items:center;width:47px;height:47px;color:white;font-weight:850;font-size:24px;border-radius:14px;background:linear-gradient(135deg,#7c7bf3,#5457d5)}.brand b{display:block}.brand small{font-size:10px;letter-spacing:1.5px;color:#9aa4bd}.hint{color:#8590a6;line-height:1.75;font-size:13px;margin:0 0 24px}h1{font-size:24px;letter-spacing:-.8px;margin:0 0 10px}label{display:block;font-size:12px;font-weight:650;color:#5b6580;margin-top:16px}input{width:100%;border:1px solid #dce1ed;border-radius:11px;padding:14px;margin-top:8px;outline:none;font-size:15px}input:focus{border-color:#7273e0;box-shadow:0 0 0 3px #777be518}.submit{background:#605ee0;color:white;border:none;border-radius:11px;width:100%;padding:15px;font-weight:720;margin-top:24px;cursor:pointer}.error{background:#fff0f2;color:#b23c59;border-radius:9px;padding:12px;font-size:12px;margin-bottom:10px}.notice{background:#f0f2ff;color:#5b5fa4;border-radius:9px;padding:12px;font-size:12px;margin-bottom:12px;line-height:1.65}.footer{font-size:11px;color:#9ba5b7;text-align:center;margin-top:24px}.footer a{color:#6567c5;text-decoration:none}</style></head><body><div class="card"><div class="brand"><div class="logo">Z</div><div><b>ZZS IPA Store</b><small>SECURE ADMIN</small></div></div>'+body+'<div class="footer">私人管理后台 · <a href="https://repo.zrh.jp/">返回软件源首页</a></div></div></body></html>';
  return resp(html,status,{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
}
function loginPage(error="") {
  return htmlPage("安全登录",
    '<h1>登录管理后台</h1><p class="hint">请输入 ZZS IPA Store 管理账号与密码，验证通过后才能访问后台内容。</p>'+
    (error?'<div class="error">'+escapeHTML(error)+'</div>':'')+
    '<form method="post" action="/admin/login" autocomplete="on">'+
    '<label for="username">用户名<input id="username" name="username" autocomplete="username" required maxlength="32"></label>'+
    '<label for="password">密码<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="12"></label>'+
    '<button class="submit" type="submit">安全登录 →</button></form>',error?401:200);
}
function changePage(user,error="") {
  const forced=Number(user.must_change)===1;
  return htmlPage("修改账号密码",
    '<h1>'+(forced?'首次登录安全设置':'修改账号密码')+'</h1>'+
    '<p class="hint">'+(forced?'首次登录必须修改默认密码，之后才能进入管理后台。':'你可以修改用户名和密码，修改成功后需要重新登录。')+'</p>'+
    (forced?'<div class="notice">密码要求：10–12 位，必须包含大写字母、小写字母和数字。建议使用随机密码。</div>':'')+
    (error?'<div class="error">'+escapeHTML(error)+'</div>':'')+
    '<form method="post" action="/admin/change">'+
    '<label>当前密码<input name="old_password" type="password" autocomplete="current-password" required></label>'+
    '<label>新用户名<input name="username" value="'+escapeHTML(user.username)+'" required minlength="3" maxlength="32" pattern="[A-Za-z][A-Za-z0-9._-]{2,31}"></label>'+
    '<label>新密码（10–12 位）<input name="new_password" type="password" autocomplete="new-password" minlength="10" maxlength="12" required></label>'+
    '<label>再次输入新密码<input name="confirm_password" type="password" autocomplete="new-password" minlength="10" maxlength="12" required></label>'+
    '<button class="submit" type="submit">保存账号密码并重新登录 →</button></form>',error?400:200);
}
async function form(request) {
  const n=Number(request.headers.get("content-length")||0);
  if(n>4096)throw new Error("表单内容超出限制。");
  const type=request.headers.get("content-type")||"";
  if(!type.startsWith("application/x-www-form-urlencoded"))throw new Error("不支持的表单格式。");
  const str=await request.text();
  if(str.length>4096)throw new Error("表单过大。");
  return new URLSearchParams(str);
}
async function login(request,env) {
  if(!validOrigin(request))return deny();
  let data;
  try{data=await form(request);}catch(e){return loginPage(e.message);}
  const name=String(data.get("username")||"").trim();
  const pass=String(data.get("password")||"");
  const user=await currentUser(env.DB);
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const key=await hashText(ip+"|"+name.toLowerCase());
  const attempt=await env.DB.prepare("SELECT failures,expires_at FROM login_attempts WHERE fingerprint=?").bind(key).first();
  if(attempt&&attempt.expires_at>now()&&attempt.failures>=8)return loginPage("尝试次数过多，请在 15 分钟后再试。");
  const valid=!!user&&name===user.username&&await verify(pass,user);
  if(!valid){
    if(attempt&&attempt.expires_at>now()){
      await env.DB.prepare("UPDATE login_attempts SET failures=failures+1 WHERE fingerprint=?").bind(key).run();
    }else{
      await env.DB.prepare("INSERT OR REPLACE INTO login_attempts(fingerprint,failures,expires_at) VALUES(?,1,?)").bind(key,now()+900).run();
    }
    return loginPage("用户名或密码错误。");
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE fingerprint=?").bind(key).run();
  const session=randomBase64(32);
  await env.DB.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,1,?,?)")
    .bind(await hashText(session),now()+SESSION_LIFETIME,now()).run();
  return redirect(user.must_change?"/admin/change":"/admin/",cookieHeader(session));
}
async function change(request,env,session){
  if(!validOrigin(request))return deny();
  const user=await currentUser(env.DB);
  let f;
  try{f=await form(request);}catch(e){return changePage(user,e.message);}
  const old=String(f.get("old_password")||"");
  const name=String(f.get("username")||"").trim();
  const password=String(f.get("new_password")||"");
  const confirm=String(f.get("confirm_password")||"");
  if(!await verify(old,user))return changePage(user,"当前密码错误。");
  if(!/^[A-Za-z][A-Za-z0-9._-]{2,31}$/.test(name))return changePage(user,"用户名必须是 3–32 位，以英文字母开头。");
  if(password.length<10||password.length>12||!/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).+$/.test(password))return changePage(user,"新密码必须是 10–12 位，同时包含大写字母、小写字母和数字。");
  if(password!==confirm)return changePage(user,"两次输入的新密码不一致。");
  if(await verify(password,user))return changePage(user,"新密码不能与当前密码相同。");
  const salt=encodeBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash=await passwordHash(password,salt);
  await env.DB.batch([
    env.DB.prepare("UPDATE admin_account SET username=?,salt=?,password_hash=?,iterations=?,must_change=0,updated_at=? WHERE id=1")
      .bind(name,salt,hash,ITERATIONS,now()),
    env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=1")
  ]);
  return redirect("/admin/login?updated=1",clearCookie());
}
async function logout(request,env,session){
  if(!validOrigin(request))return deny();
  await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?").bind(session.token_hash).run();
  return redirect("/admin/login",clearCookie());
}
async function gh(request,env) {
  if(!env.GITHUB_TOKEN)return {ok:false,status:503,data:{message:"未配置 Cloudflare Worker 的 GITHUB_TOKEN Secret。"}};
  const reply=await fetch(request,{
    headers:{
      "Accept":"application/vnd.github+json",
      "Authorization":"Bearer "+env.GITHUB_TOKEN,
      "X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"ZZS-IPA-Store-Admin",
      ...(request.method==="PUT"?{"Content-Type":"application/json"}:{})
    }
  });
  const data=await reply.json().catch(()=>({message:"GitHub 返回了无法解析的结果。"}));
  return {ok:reply.ok,status:reply.status,data};
}
function ghFile(path) {
  return GH_ROOT+path.split("/").map(encodeURIComponent).join("/");
}
async function getSource(env) {
  const result=await gh(new Request(ghFile("docs/source.json")),env);
  if(!result.ok)throw new Error("GitHub "+result.status+"："+(result.data.message||"读取失败"));
  if(result.data.encoding!=="base64"||!result.data.sha)throw new Error("GitHub 没有提供 source.json 的 Base64 内容或 SHA。");
  const raw=decodeBase64(String(result.data.content).replace(/\s/g,""));
  return {sha:result.data.sha,source:JSON.parse(new TextDecoder().decode(raw))};
}
function assertUrl(input){
  if(typeof input!=="string")throw new Error("下载链接格式无效。");
  const u=new URL(input);
  if(u.protocol!=="https:"||u.username||u.password)throw new Error("只支持无内嵌账号密码的 HTTPS URL。");
}
function checkSource(src){
  if(!src||typeof src!=="object"||Array.isArray(src)||!Array.isArray(src.apps)||src.apps.length>250||!Array.isArray(src.news))throw new Error("软件源 JSON 结构无效。");
  if(typeof src.name!=="string"||!src.name.trim()||src.name.length>150)throw new Error("软件源名称无效。");
  const seen=new Set();
  for(const app of src.apps){
    if(!app||typeof app!=="object")throw new Error("应用结构无效。");
    if(typeof app.name!=="string"||!app.name.trim()||app.name.length>200)throw new Error("应用名称无效。");
    if(typeof app.bundleIdentifier!=="string"||!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(app.bundleIdentifier))throw new Error("Bundle ID 无效。");
    if(seen.has(app.bundleIdentifier))throw new Error("相同 Bundle ID 不能发布多次。");
    seen.add(app.bundleIdentifier);
    if(typeof app.developerName!=="string"||!app.developerName.trim()||typeof app.localizedDescription!=="string"||!app.localizedDescription.trim())throw new Error("请填写开发者和应用描述。");
    assertUrl(app.iconURL);
    if(!Array.isArray(app.versions)||app.versions.length===0||app.versions.length>150)throw new Error("每个应用必须至少有一个版本，最多 150 个。");
    const vkeys=new Set();
    for(const v of app.versions){
      if(typeof v.version!=="string"||!v.version||typeof v.buildVersion!=="string"||!v.buildVersion)throw new Error("版本号或 Build Version 无效。");
      if(typeof v.date!=="string"||!v.date||!Number.isSafeInteger(v.size)||v.size<1)throw new Error("版本发布日期或文件大小无效。");
      assertUrl(v.downloadURL);
      const key=v.version+"|"+v.buildVersion;
      if(vkeys.has(key))throw new Error("版本号和 Build Version 重复。");
      vkeys.add(key);
    }
    const perms=app.appPermissions;
    if(!perms||!Array.isArray(perms.entitlements)||!perms.privacy||typeof perms.privacy!=="object"||Array.isArray(perms.privacy))throw new Error("appPermissions 必须包含 entitlements 数组与 privacy 对象。");
    if(perms.entitlements.some(x=>typeof x!=="string")||Object.values(perms.privacy).some(v=>typeof v!=="string"))throw new Error("应用权限值格式错误。");
  }
}
async function handleAPI(request,env,path){
  if(path==="/admin/api/source"&&request.method==="GET"){
    try{return json(await getSource(env));}catch(e){return json({error:e.message},502);}
  }
  if(path==="/admin/api/source"&&request.method==="PUT"){
    if(!validOrigin(request))return deny();
    if(Number(request.headers.get("content-length")||0)>1024*1024)return json({error:"源文件超过 1 MiB 限制。"},413);
    let body;
    try{
      const text=await request.text();
      if(text.length>1024*1024)throw new Error("软件源 JSON 超过限制。");
      body=JSON.parse(text);
      checkSource(body.source);
      if(typeof body.sha!=="string"||!body.sha)throw new Error("缺少旧版本 SHA。");
    }catch(e){return json({error:e.message},400);}
    try{
      const current=await getSource(env);
      if(current.sha!==body.sha)return json({error:"软件源已经被其他管理会话修改。请刷新后重试。"},409);
      const bytes=encoder.encode(JSON.stringify(body.source,null,2)+"\n");
      const payload={branch:"main",message:"Publish ZZS IPA Store source via secure admin",sha:body.sha,content:encodeBase64(bytes)};
      const result=await gh(new Request(ghFile("docs/source.json"),{method:"PUT",body:JSON.stringify(payload)}),env);
      if(!result.ok)return json({error:result.data.message||"GitHub 拒绝保存。"},result.status);
      return json({sha:result.data.content?.sha,source:body.source});
    }catch(e){return json({error:e.message},502);}
  }
  if(path==="/admin/api/upload"&&request.method==="POST"){
    if(!validOrigin(request))return deny();
    const url=new URL(request.url);
    const type=url.searchParams.get("type");
    const name=url.searchParams.get("name")||"";
    if(!["ipa","icon"].includes(type)||!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,110}$/.test(name))return json({error:"上传类型或文件名无效。"},400);
    if(type==="ipa"&&!name.endsWith(".ipa")||type==="icon"&&!name.endsWith(".png"))return json({error:"文件扩展名不符合要求。"},400);
    const max=type==="ipa"?20*1024*1024:3*1024*1024;
    if(Number(request.headers.get("content-length")||0)>max)return json({error:"上传超过限制。大型 IPA 请使用 GitHub Releases。"},413);
    const bytes=new Uint8Array(await request.arrayBuffer());
    if(bytes.length<100||bytes.length>max)return json({error:"文件大小无效。"},413);
    if(type==="ipa" && !(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4))return json({error:"IPA 不是有效的 ZIP 文件头。"},400);
    if(type==="icon" && !(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71))return json({error:"图标必须是 PNG。"},400);
    const path="docs/"+(type==="ipa"?"ipas":"icons")+"/"+name;
    const data={branch:"main",message:"Upload "+type+" "+name,content:encodeBase64(bytes)};
    const result=await gh(new Request(ghFile(path),{method:"PUT",body:JSON.stringify(data)}),env);
    if(!result.ok)return json({error:result.data.message||"GitHub 上传失败。"},result.status);
    return json({url:"https://repo.zrh.jp/"+(type==="ipa"?"ipas":"icons")+"/"+encodeURIComponent(name)});
  }
  return json({error:"接口不存在"},404);
}
export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url),p=url.pathname;
      if(!p.startsWith("/admin"))return resp("Not found",404);
      if(!env.DB)return resp("数据库尚未绑定，请配置 Cloudflare D1。",503);
      await seedDB(env.DB);
      if(p==="/admin")return redirect("/admin/");
      if(p==="/admin/login"&&request.method==="GET"){
        const session=await getSession(request,env.DB);
        if(session)return redirect(session.must_change?"/admin/change":"/admin/");
        return htmlPage("安全登录",
          '<h1>登录管理后台</h1><p class="hint">请使用管理员账号密码登录。未经验证无法进入后台。</p>'+
          (url.searchParams.has("updated")?'<div class="notice">账号密码已更新，请用新密码重新登录。</div>':'')+
          '<form method="post" action="/admin/login"><label>用户名<input name="username" autocomplete="username" maxlength="32" required></label><label>密码<input name="password" type="password" autocomplete="current-password" maxlength="12" required></label><button class="submit" type="submit">安全登录 →</button></form>');
      }
      if(p==="/admin/login"&&request.method==="POST")return login(request,env);
      const session=await getSession(request,env.DB);
      if(!session){
        if(p.startsWith("/admin/api/"))return unauthorized();
        return redirect("/admin/login");
      }
      if(p==="/admin/logout"&&request.method==="POST")return logout(request,env,session);
      if(p==="/admin/change"&&request.method==="POST")return change(request,env,session);
      if(p==="/admin/change"&&request.method==="GET")return changePage(session);
      if(session.must_change){
        if(p.startsWith("/admin/api/"))return json({error:"首次登录必须先修改账号密码。"},403);
        return redirect("/admin/change");
      }
      if(p.startsWith("/admin/api/"))return handleAPI(request,env,p);
      if(request.method!=="GET"&&request.method!=="HEAD")return resp("Method not allowed",405);
      const asset=await env.ASSETS.fetch(request);
      const headers=new Headers(asset.headers);
      headers.set("Cache-Control","private, no-store, max-age=0");
      headers.set("X-Content-Type-Options","nosniff");
      headers.set("X-Robots-Tag","noindex, nofollow");
      headers.set("Referrer-Policy","no-referrer");
      headers.set("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
      return new Response(asset.body,{status:asset.status,headers});
    }catch(e){
      console.error("ZZS admin gateway error",String(e.message||e));
      return resp("后台暂时无法使用。请检查 Cloudflare Worker、D1 和 GitHub Token 配置。",503);
    }
  }
};