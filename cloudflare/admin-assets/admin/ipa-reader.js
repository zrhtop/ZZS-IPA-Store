"use strict";

/**
 * Lightweight, dependency-free IPA reader.
 * Supports standard ZIP32, deflate-raw, XML and binary Apple property lists.
 * Never executes code extracted from an IPA.
 */

const DECODER = new TextDecoder("utf-8");
const MAX_PLIST_BYTES = 6 * 1024 * 1024;
const MAX_ICON_BYTES = 4 * 1024 * 1024;

function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("找不到 ZIP 目录。请确认这是完整的 IPA 文件。");
  const count = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("暂不支持 ZIP64 格式的 IPA，建议手动填写应用信息。");
  }
  let cursor = centralOffset;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("IPA ZIP 目录损坏。");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw new Error("IPA 文件名范围无效。");
    const name = DECODER.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name && !name.endsWith("/")) entries.push({name, method, flags, compressedSize, uncompressedSize, localOffset});
    cursor = next;
  }
  return {entries, view};
}

async function content(bytes, view, entry, max = MAX_PLIST_BYTES) {
  if (entry.uncompressedSize > max) throw new Error("内部文件尺寸超过安全上限：" + entry.name);
  if ((entry.flags & 1) !== 0) throw new Error("暂不支持加密 ZIP。");
  const off = entry.localOffset;
  if (off + 30 > bytes.length || view.getUint32(off, true) !== 0x04034b50) throw new Error("IPA 本地 ZIP 头无效。");
  const start = off + 30 + view.getUint16(off + 26, true) + view.getUint16(off + 28, true);
  const finish = start + entry.compressedSize;
  if (start < 0 || finish > bytes.length) throw new Error("IPA 压缩数据不完整。");
  const zipped = bytes.subarray(start, finish);
  if (entry.method === 0) return zipped;
  if (entry.method !== 8) throw new Error("不支持的 ZIP 压缩算法：" + entry.method);
  if (typeof DecompressionStream !== "function") throw new Error("当前浏览器不支持 IPA 解压，请使用最新版本 Safari 或 Chrome。");
  let stream;
  try {
    stream = new Blob([zipped]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (result.length > max) throw new Error("解压数据超出安全限制。");
    return result;
  } catch (e) {
    throw new Error("IPA 解压失败：" + e.message);
  }
}

function parseXMLPlist(bytes) {
  const xml = DECODER.decode(bytes);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML plist 格式错误。");
  const root = doc.documentElement;
  if (!root || root.nodeName !== "plist") throw new Error("不是有效的 plist 文件。");
  function value(node) {
    switch (node.nodeName) {
      case "string": case "date": return node.textContent ?? "";
      case "integer": return Number.parseInt(node.textContent || "0", 10);
      case "real": return Number.parseFloat(node.textContent || "0");
      case "true": return true;
      case "false": return false;
      case "data": return (node.textContent || "").trim();
      case "array": return [...node.children].map(value);
      case "dict": {
        const out = Object.create(null);
        const nodes = [...node.children];
        for (let i = 0; i < nodes.length - 1; i += 2) {
          if (nodes[i].nodeName !== "key") continue;
          const key = nodes[i].textContent || "";
          if (key !== "__proto__" && key !== "constructor" && key !== "prototype") out[key] = value(nodes[i + 1]);
        }
        return out;
      }
      default: return null;
    }
  }
  const target = [...root.children][0];
  if (!target) throw new Error("plist 内容为空。");
  return value(target);
}

function parseBinaryPlist(bytes) {
  if (bytes.length < 40) throw new Error("Binary plist 不完整。");
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6];
  const refSize = bytes[trailer + 7];
  if (!offsetSize || offsetSize > 8 || !refSize || refSize > 8) throw new Error("Binary plist trailer 异常。");
  function readInt(pos, len) {
    if (pos < 0 || pos + len > bytes.length) throw new Error("Binary plist 数据越界。");
    let num = 0;
    for (let i = 0; i < len; i++) {
      num = num * 256 + bytes[pos + i];
      if (!Number.isSafeInteger(num)) throw new Error("Binary plist 数值过大。");
    }
    return num;
  }
  const objects = readInt(trailer + 8, 8);
  const top = readInt(trailer + 16, 8);
  const offsetTable = readInt(trailer + 24, 8);
  if (objects < 1 || objects > 500000 || top >= objects || offsetTable + objects * offsetSize > trailer) throw new Error("Binary plist 偏移表异常。");
  const cache = new Map();
  const active = new Set();
  function parse(id) {
    if (id >= objects) throw new Error("Binary plist 对象索引无效。");
    if (cache.has(id)) return cache.get(id);
    if (active.has(id)) throw new Error("Binary plist 存在循环引用。");
    active.add(id);
    const pos = readInt(offsetTable + id * offsetSize, offsetSize);
    if (pos >= offsetTable) throw new Error("Binary plist 对象超出范围。");
    const marker = bytes[pos];
    const kind = marker >> 4, low = marker & 15;
    let start = pos + 1, len = low;
    if (low === 15 && [4,5,6,10,13].includes(kind)) {
      if ((bytes[start] >> 4) !== 1) throw new Error("Binary plist 长度编码不支持。");
      const n = 2 ** (bytes[start] & 15);
      len = readInt(start + 1, n);
      start += n + 1;
    }
    if (len > 10000000) throw new Error("Binary plist 对象过大。");
    let out;
    switch (kind) {
      case 0:
        out = low === 8 ? false : low === 9 ? true : null;
        break;
      case 1:
        out = readInt(start, 2 ** low);
        break;
      case 2:
        out = low === 2 ? d.getFloat32(start, false) : low === 3 ? d.getFloat64(start, false) : null;
        break;
      case 3:
        out = new Date(Date.UTC(2001, 0, 1) + d.getFloat64(start, false) * 1000).toISOString();
        break;
      case 4:
        if (start + len > bytes.length) throw new Error("Binary plist data 越界。");
        out = bytes.subarray(start, start + len);
        break;
      case 5:
        if (start + len > bytes.length) throw new Error("Binary plist string 越界。");
        out = DECODER.decode(bytes.subarray(start, start + len));
        break;
      case 6: {
        if (start + len * 2 > bytes.length) throw new Error("Binary plist UTF-16 越界。");
        const chars = [];
        for (let i = 0; i < len; i++) chars.push(d.getUint16(start + i * 2, false));
        const parts = [];
        for (let i = 0; i < chars.length; i += 8192) parts.push(String.fromCharCode(...chars.slice(i, i + 8192)));
        out = parts.join("");
        break;
      }
      case 8:
        out = readInt(start, low + 1);
        break;
      case 10:
        out = [];
        cache.set(id, out);
        for (let i = 0; i < len; i++) out.push(parse(readInt(start + i * refSize, refSize)));
        break;
      case 13: {
        out = Object.create(null);
        cache.set(id, out);
        for (let i = 0; i < len; i++) {
          const key = String(parse(readInt(start + i * refSize, refSize)));
          if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
          out[key] = parse(readInt(start + (len + i) * refSize, refSize));
        }
        break;
      }
      default:
        out = null;
    }
    cache.set(id, out);
    active.delete(id);
    return out;
  }
  return parse(top);
}

function plist(bytes) {
  if (DECODER.decode(bytes.subarray(0, 8)) === "bplist00") return parseBinaryPlist(bytes);
  return parseXMLPlist(bytes);
}

function requiredString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function inspectIPA(file) {
  if (!file || !/\.ipa$/i.test(file.name)) throw new Error("请选择 .ipa 文件。");
  if (file.size > 100 * 1024 * 1024) throw new Error("浏览器仅自动检查 100 MiB 以内的 IPA，大型文件请使用 GitHub Releases 并手动填入信息。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const {entries, view} = zipEntries(bytes);
  const infoEntry = entries.find(e => /^Payload\/[^/]+\.app\/Info\.plist$/i.test(e.name));
  if (!infoEntry) throw new Error("IPA 中找不到 Payload/*.app/Info.plist。");
  const info = plist(await content(bytes, view, infoEntry));
  if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error("主程序 Info.plist 无效。");
  const bundleID = requiredString(info.CFBundleIdentifier);
  const name = requiredString(info.CFBundleDisplayName) || requiredString(info.CFBundleName) || (bundleID ? bundleID.split(".").at(-1) : "") || file.name.replace(/\.ipa$/i, "");
  const version = requiredString(info.CFBundleShortVersionString);
  const buildVersion = requiredString(info.CFBundleVersion) || version;
  const minOSVersion = requiredString(info.MinimumOSVersion);
  const privacy = Object.create(null);
  for (const [key, val] of Object.entries(info)) {
    if (key.endsWith("UsageDescription") && typeof val === "string") privacy[key] = val;
  }
  const extensionEntries = entries.filter(e => /^Payload\/[^/]+\.app\/PlugIns\/[^/]+\.appex\/Info\.plist$/i.test(e.name)).slice(0, 40);
  let extensionErrors = 0;
  for (const ext of extensionEntries) {
    try {
      const p = plist(await content(bytes, view, ext));
      for (const [key,val] of Object.entries(p)) if (key.endsWith("UsageDescription") && typeof val === "string") privacy[key] = val;
    } catch { extensionErrors++; }
  }
  let hasXcent = false;
  const entitlements = new Set();
  const xcentEntries = entries.filter(e => /\.(?:xcent|entitlements)$/i.test(e.name)).slice(0, 25);
  for (const ent of xcentEntries) {
    try {
      const raw = await content(bytes, view, ent);
      const obj = plist(raw);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        hasXcent = true;
        for (const key of Object.keys(obj)) if (!["application-identifier","com.apple.developer.team-identifier"].includes(key)) entitlements.add(key);
      }
    } catch { /* signed IPA may not include separate entitlement files */ }
  }
  const mainPrefix = infoEntry.name.slice(0, -"Info.plist".length);
  const iconEntry = entries
    .filter(e => e.name.startsWith(mainPrefix) && e.name.toLowerCase().endsWith(".png") && e.uncompressedSize < MAX_ICON_BYTES)
    .sort((a,b) => {
      function score(e) {
        const s = e.name.toLowerCase();
        return (s.includes("appicon") ? 100 : 0) + (s.includes("icon") ? 40 : 0) + Math.min(e.uncompressedSize, 100000) / 100000 - (s.includes("/plugins/") ? 200 : 0);
      }
      return score(b) - score(a);
    })[0];
  let iconBytes = null;
  if (iconEntry && /icon/i.test(iconEntry.name)) {
    try {
      const result = await content(bytes, view, iconEntry, MAX_ICON_BYTES);
      if (result.length > 8 && result[0] === 137 && result[1] === 80 && result[2] === 78 && result[3] === 71) iconBytes = new Uint8Array(result);
    } catch { /* assets catalog icons are often inaccessible */ }
  }
  return {
    name,bundleID,version,buildVersion,minOSVersion,
    privacy,entitlements:[...entitlements].sort(),iconBytes,
    meta: {entries:entries.length,extensions:extensionEntries.length,extensionErrors,hasXcent,iconFound:!!iconBytes},
    warnings: [
      ...(hasXcent ? ["读取到 .xcent 权限文件，但仍需验证实际代码签名及全部扩展权限。"] : ["未找到独立 .xcent 文件。IPA 的实际签名 Entitlements 需要人工检查。"]),
      ...(extensionEntries.length ? ["包含 " + extensionEntries.length + " 个 App Extension，必须核对它们的权限。"] : []),
      ...(extensionErrors ? ["有 " + extensionErrors + " 个扩展 Info.plist 未成功读取。"] : []),
      ...(!iconBytes ? ["未找到可直接提取的 PNG 图标。可手动填写图标 URL，或使用默认图标。"] : [])
    ]
  };
}
