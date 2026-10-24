"use strict";

// ZZS IPA Store encrypted local account.
// GitHub Pages is public: this protects the token at rest in this browser,
// not the HTML/JS files or the public repository.
const STORE_KEY = "zzs_ipa_store_local_vault_v2";
const ENCRYPTION_ITERATIONS = 320000;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const b64 = b => btoa(String.fromCharCode(...b));
const un64 = s => Uint8Array.from(atob(s),ch=>ch.charCodeAt(0));
const random = n => crypto.getRandomValues(new Uint8Array(n));

export function validateUsername(username) {
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,31}$/.test(username)) throw new Error("用户名需为 3–32 位，首位必须是英文字母。");
  return username;
}
export function validatePassword(password, username="") {
  if (password.length<10 || password.length>12) throw new Error("密码必须为 10–12 位（包含 10 和 12）。");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw new Error("密码必须包含大写字母、小写字母和数字。");
  if(password.toLowerCase()===username.toLowerCase()) throw new Error("请换一个未公开使用过的新密码。");
  return password;
}
function validateVault(vault) {
  if (!vault || vault.format!==2 || typeof vault.username!=="string" ||
    !/^[A-Za-z][A-Za-z0-9._-]{2,31}$/.test(vault.username) ||
    typeof vault.salt!=="string" || typeof vault.iv!=="string" ||
    typeof vault.ciphertext!=="string" || vault.iterations!==ENCRYPTION_ITERATIONS ||
    !/^[A-Za-z0-9+/=]{20,}$/.test(vault.ciphertext) ||
    vault.ciphertext.length>3000) throw new Error("本地加密账户文件不完整或版本不兼容。");
  return vault;
}
export function readVault() {
  const text=localStorage.getItem(STORE_KEY);
  if (!text) return null;
  try { return validateVault(JSON.parse(text)); }
  catch { throw new Error("本地加密账户文件损坏，可以重新绑定 GitHub Token。"); }
}
async function derive(password,salt) {
  const material=await crypto.subtle.importKey("raw",ENCODER.encode(password),{name:"PBKDF2"},false,["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2",salt,iterations:ENCRYPTION_ITERATIONS,hash:"SHA-256"},
    material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]
  );
}
function additionalData(username) { return ENCODER.encode("ZZS-IPA-Store:v2:"+username.toLowerCase()); }
export async function createVault(username,password,token) {
  validateUsername(username);
  validatePassword(password,username);
  if (typeof token!=="string" || !/^(github_pat_|gh[pousr]_)/.test(token) || token.length<30) throw new Error("请输入有效格式的 GitHub Personal Access Token。");
  const salt=random(16),iv=random(12);
  const key=await derive(password,salt);
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt(
    {name:"AES-GCM",iv,additionalData:additionalData(username)},key,ENCODER.encode(token)
  ));
  const vault={
    format:2,username,salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext),
    iterations:ENCRYPTION_ITERATIONS,createdAt:new Date().toISOString()
  };
  return validateVault(vault);
}
export async function decryptVault(vault,username,password) {
  validateVault(vault);
  if (username!==vault.username) throw new Error("账号或密码不正确。");
  try {
    const key=await derive(password,un64(vault.salt));
    const plain=await crypto.subtle.decrypt(
      {name:"AES-GCM",iv:un64(vault.iv),additionalData:additionalData(username)},
      key,un64(vault.ciphertext)
    );
    const token=DECODER.decode(plain);
    if (!/^(github_pat_|gh[pousr]_)/.test(token)) throw new Error();
    return token;
  } catch { throw new Error("账号或密码不正确。"); }
}
export function saveVault(vault) {
  const data=validateVault(vault);
  // Store only encrypted token, never plain credentials.
  localStorage.setItem(STORE_KEY,JSON.stringify(data));
}
export function clearVault() {localStorage.removeItem(STORE_KEY);}
export function exportVault() {
  const vault=readVault();
  if (!vault) throw new Error("尚未设置管理账号。");
  return new Blob([JSON.stringify(vault,null,2)+"\n"],{type:"application/json"});
}
export async function importVault(file) {
  if(!file || file.size>10000) throw new Error("账户备份文件无效或过大。");
  const data=validateVault(JSON.parse(await file.text()));
  return data;
}
