"use strict";
/* Read the main application's Info.plist directly in the browser. No IPA bytes are sent to third-party services. */
(() => {
  const utf8 = new TextDecoder("utf-8");
  const MAX_ENTRIES = 150000;
  const MAX_PLIST_SIZE = 8 * 1024 * 1024;
  const equal = (bytes, start, str) => start >= 0 && start + str.length <= bytes.length && [...str].every((c, i) => bytes[start + i] === c.charCodeAt(0));
  function zipEntry(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const end = data.byteLength;
    let eocd = -1;
    for (let i = end - 22; i >= Math.max(0, end - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("无法读取 IPA：找不到 ZIP 目录");
    const count = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    const cdSize = view.getUint32(eocd + 12, true);
    if (count === 0xffff || cdOffset === 0xffffffff || count > MAX_ENTRIES || cdOffset + cdSize > end)
      throw new Error("IPA 使用不支持的 ZIP64 或目录格式，请手动填写信息");
    const entries = [];
    let pos = cdOffset;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw new Error("IPA ZIP 中央目录格式有误");
      const flags = view.getUint16(pos + 8, true);
      const method = view.getUint16(pos + 10, true);
      const compressed = view.getUint32(pos + 20, true);
      const expanded = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const offset = view.getUint32(pos + 42, true);
      if (pos + 46 + nameLen + extraLen + commentLen > end) throw new Error("ZIP 文件名损坏");
      const name = utf8.decode(data.subarray(pos + 46, pos + 46 + nameLen));
      entries.push({name, flags, method, compressed, expanded, offset});
      pos += 46 + nameLen + extraLen + commentLen;
    }
    const info = entries.find(e => /^Payload\/[^/]+\.app\/Info\.plist$/i.test(e.name)) ||
      entries.find(e => /^Payload\/[^/]+\.app\/[^/]+\.app\/Info\.plist$/i.test(e.name));
    if (!info) throw new Error("IPA 中找不到主应用的 Info.plist");
    if (info.expanded > MAX_PLIST_SIZE) throw new Error("Info.plist 文件过大，无法安全解析");
    if (info.flags & 1) throw new Error("IPA 中的 Info.plist 被加密");
    if (info.offset + 30 > end || view.getUint32(info.offset, true) !== 0x04034b50) throw new Error("IPA ZIP 头部无效");
    const start = info.offset + 30 + view.getUint16(info.offset + 26, true) + view.getUint16(info.offset + 28, true);
    if (start + info.compressed > end) throw new Error("IPA 包不完整");
    return {bytes:data.subarray(start, start + info.compressed),method:info.method,expanded:info.expanded};
  }
  async function decompress(entry) {
    if (entry.method === 0) return entry.bytes;
    if (entry.method !== 8) throw new Error("Info.plist 采用不支持的 ZIP 压缩方式");
    if (!("DecompressionStream" in window)) throw new Error("当前浏览器不支持压缩解析，请手动填写应用资料");
    const stream = new Blob([entry.bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (bytes.length > MAX_PLIST_SIZE) throw new Error("解压后的 Info.plist 超出限制");
    return bytes;
  }
  function xmlPlist(bytes) {
    const doc = new DOMParser().parseFromString(utf8.decode(bytes), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Info.plist XML 格式错误");
    const root = doc.querySelector("plist");
    if (!root) throw new Error("Info.plist XML 根节点不存在");
    function parse(el, depth = 0) {
      if (depth > 25) throw new Error("Info.plist 嵌套过深");
      const kind = el.tagName;
      if (kind === "true") return true;
      if (kind === "false") return false;
      if (kind === "string" || kind === "date" || kind === "data") return el.textContent;
      if (kind === "integer" || kind === "real") return Number(el.textContent);
      if (kind === "array") return [...el.children].map(c => parse(c, depth + 1));
      if (kind === "dict") {
        const obj = Object.create(null), elements = [...el.children];
        for (let i = 0; i + 1 < elements.length; i += 2) {
          if (elements[i].tagName !== "key") continue;
          obj[elements[i].textContent] = parse(elements[i + 1], depth + 1);
        }
        return obj;
      }
      return null;
    }
    return parse(root.firstElementChild);
  }
  function binaryPlist(data) {
    if (!equal(data, 0, "bplist00") || data.length < 40) throw new Error("未知的 Info.plist 格式");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const trailer = data.length - 32;
    const offsetSize = data[trailer + 6], refSize = data[trailer + 7];
    if (!(offsetSize >= 1 && offsetSize <= 8 && refSize >= 1 && refSize <= 8)) throw new Error("Info.plist 索引格式无效");
    function uint(start, count) {
      if (start < 0 || count < 1 || count > 8 || start + count > data.length) throw new Error("Info.plist 整数范围无效");
      let n = 0n;
      for (let i = 0; i < count; i++) n = (n << 8n) + BigInt(data[start + i]);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Info.plist 整数超出范围");
      return Number(n);
    }
    const count = uint(trailer + 8, 8);
    const rootIndex = uint(trailer + 16, 8);
    const table = uint(trailer + 24, 8);
    if (count < 1 || count > 200000 || table + count * offsetSize > trailer || rootIndex >= count) throw new Error("Info.plist 对象索引异常");
    const offsets = Array.from({length:count}, (_,i) => uint(table + i * offsetSize, offsetSize));
    const cache = new Map(), busy = new Set();
    function parse(index, depth = 0) {
      if (cache.has(index)) return cache.get(index);
      if (depth > 45 || busy.has(index) || index >= offsets.length) throw new Error("Info.plist 对象引用异常");
      const start = offsets[index];
      if (start < 8 || start >= table) throw new Error("Info.plist 对象位置无效");
      const mark = data[start], type = mark >> 4, nib = mark & 15;
      let ptr = start + 1, len = nib;
      if ([4,5,6,10,13].includes(type) && nib === 15) {
        const intmark = data[ptr++];
        if ((intmark >> 4) !== 1) throw new Error("Info.plist 长度字段损坏");
        const lengthBytes = 2 ** (intmark & 15);
        len = uint(ptr, lengthBytes);
        ptr += lengthBytes;
      }
      if (len > 2000000) throw new Error("Info.plist 对象过大");
      busy.add(index);
      let value;
      switch(type) {
        case 0: value = nib === 8 ? false : nib === 9 ? true : null; break;
        case 1: value = uint(ptr, 2 ** nib); break;
        case 2: {
          const size = 2 ** nib;
          value = size === 4 ? view.getFloat32(ptr, false) : size === 8 ? view.getFloat64(ptr, false) : 0;
          break;
        }
        case 4: value = data.subarray(ptr, ptr + len); break;
        case 5: value = utf8.decode(data.subarray(ptr, ptr + len)); break;
        case 6: {
          if (ptr + len * 2 > data.length) throw new Error("Info.plist Unicode 内容不完整");
          let str = ""; for (let i = 0; i < len; i++) str += String.fromCharCode(view.getUint16(ptr + i * 2, false));
          value = str; break;
        }
        case 8: value = uint(ptr, nib + 1); break;
        case 10: value = Array.from({length:len}, (_,i) => parse(uint(ptr + i * refSize,refSize), depth + 1)); break;
        case 13: {
          const out = Object.create(null);
          for (let i = 0; i < len; i++) {
            const key = parse(uint(ptr + i * refSize,refSize),depth + 1);
            const val = parse(uint(ptr + (len + i) * refSize,refSize),depth + 1);
            if (typeof key === "string") out[key] = val;
          }
          value = out; break;
        }
        default: value = null;
      }
      busy.delete(index); cache.set(index, value); return value;
    }
    return parse(rootIndex);
  }
  async function inspect(file) {
    if (!file || !/\.ipa$/i.test(file.name)) throw new Error("请选择扩展名为 .ipa 的文件");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const zipped = zipEntry(bytes);
    const plist = await decompress(zipped);
    const meta = equal(plist,0,"bplist00") ? binaryPlist(plist) : xmlPlist(plist);
    if (!meta || typeof meta !== "object" || !meta.CFBundleIdentifier) throw new Error("Info.plist 缺少 Bundle Identifier");
    const privacy = {};
    for (const [k,v] of Object.entries(meta)) {
      if (/^NS[A-Za-z0-9]+UsageDescription$/.test(k) && typeof v === "string") privacy[k] = v;
    }
    return {
      name:String(meta.CFBundleDisplayName || meta.CFBundleName || "").trim(),
      bundleIdentifier:String(meta.CFBundleIdentifier || ""),
      version:String(meta.CFBundleShortVersionString || "1.0"),
      buildVersion:String(meta.CFBundleVersion || "1"),
      minOSVersion:String(meta.MinimumOSVersion || ""),
      privacy
    };
  }
  window.ZZSIPA = Object.freeze({inspect});
})();