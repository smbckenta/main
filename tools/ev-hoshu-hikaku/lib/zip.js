/*
 * 無圧縮(STORE)の ZIP だけを読み書きする最小実装。
 * xlsx は ZIP なので、これだけでひな形を開いて中身を差し替えられる。
 * template/ev-hikaku-template.xlsx は STORE で保存してあるため inflate は不要。
 */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u32(dv, off) { return dv.getUint32(off, true); }
  function u16(dv, off) { return dv.getUint16(off, true); }

  // ZIP を { 名前: Uint8Array } に展開する。順序は names で保持する。
  function read(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP の終端レコードが見つかりません');

    var count = u16(dv, eocd + 10);
    var cdOff = u32(dv, eocd + 16);
    var files = {};
    var names = [];
    var p = cdOff;

    for (var n = 0; n < count; n++) {
      if (u32(dv, p) !== 0x02014b50) throw new Error('ZIP 中央ディレクトリが壊れています');
      var method = u16(dv, p + 10);
      var compSize = u32(dv, p + 20);
      var nameLen = u16(dv, p + 28);
      var extraLen = u16(dv, p + 30);
      var commentLen = u16(dv, p + 32);
      var localOff = u32(dv, p + 42);
      var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (method !== 0) {
        throw new Error('圧縮された ZIP には対応していません（' + name + '）。無圧縮のひな形を使ってください。');
      }
      var lNameLen = u16(dv, localOff + 26);
      var lExtraLen = u16(dv, localOff + 28);
      var dataOff = localOff + 30 + lNameLen + lExtraLen;
      files[name] = bytes.subarray(dataOff, dataOff + compSize);
      names.push(name);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { files: files, names: names };
  }

  // { name, data } の配列から STORE 形式の ZIP を組み立てる。
  function write(entries) {
    var locals = [];
    var centrals = [];
    var offset = 0;

    entries.forEach(function (e) {
      var nameBytes = new TextEncoder().encode(e.name);
      var data = e.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(local.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);          // version needed
      ldv.setUint16(6, 0x0800, true);      // UTF-8 のファイル名
      ldv.setUint16(8, 0, true);           // STORE
      ldv.setUint16(10, 0, true);          // time
      ldv.setUint16(12, 0x21, true);       // date (1996-01-01)
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, data.length, true);
      ldv.setUint32(22, data.length, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      var central = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(central.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, 0, true);
      cdv.setUint16(14, 0x21, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    });

    var cdSize = centrals.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array(22);
    var edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, entries.length, true);
    edv.setUint16(10, entries.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, offset, true);

    var total = offset + cdSize + 22;
    var out = new Uint8Array(total);
    var pos = 0;
    locals.concat(centrals).concat([end]).forEach(function (chunk) {
      out.set(chunk, pos);
      pos += chunk.length;
    });
    return out;
  }

  global.MiniZip = { read: read, write: write, crc32: crc32 };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.MiniZip;
