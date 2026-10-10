/**
 * PTI支払管理: ｺｰﾄﾞDB → 各PT別シートへの月次転記
 *
 * 使い方(PTI支払管理にひも付いた Apps Script プロジェクトに貼り付けて実行):
 *   1. TY / TM に今回転記する計上月を入れる
 *   2. DRY_RUN = true のまま claudeRun を実行し、ログで追加行数・新規契約を確認
 *   3. DRY_RUN = false にして再実行(最初にスプレッドシート全体のバックアップを作成する)
 *
 * やること:
 *   - 前月(計上月 = TM-1)の行をそのまま当月分として複製(固定額のL列はそのまま固定額)
 *   - ｺｰﾄﾞDB の初計上月(B列) = 当月 の新規契約を追加(備考に物件名。「複数」はメモの中身)
 *   - Code 昇順で各シートの末尾に追記。L=H*K / M=前行M+L / N=EDATE(C,1)
 *   - 色: 追加行のC列=紫、M列は最終行のみ(1万円以上=水色/未満=紫)、ｺｰﾄﾞDB F列=緑
 *   - 当月行が既にあるシートはスキップ(二重転記防止)
 *   - 9月締で支払った分のM列0リセットは行わない(支払後に手動で行う運用)
 */
function claudeRun() {
  var TY = 2026, TM = 10;
  var DRY_RUN = true;
  var BACKUP = true;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var all = ss.getSheets();
  var db = all[1];
  if (db.getName().indexOf('DB') < 0) throw new Error('2枚目がｺｰﾄﾞDBではありません: ' + db.getName());

  var CODE = /^[A-Za-z]+-\d+/;
  var T = TY * 100 + TM;
  var P = TM === 1 ? (TY - 1) * 100 + 12 : T - 1;
  var TDATE = new Date(TY, TM - 1, 1);
  var CYAN = '#00ffff', PURPLE = '#9900ff', GREEN = '#00ff00';
  var OVERRIDE = { 'ITK-012': 'KGA赤塚' };  // Code単位の転記先例外
  var SPECIAL = {};                          // 新規契約でL列を固定額にする場合 { 'XXX-001': 1000 }

  function ym(d) { return d instanceof Date ? d.getFullYear() * 100 + d.getMonth() + 1 : null; }
  function codeKey(c) {
    var m = String(c).trim().match(/^([A-Za-z]+)-(\d+)/);
    return m ? [m[1].toUpperCase(), parseInt(m[2], 10)] : ['', 0];
  }
  function cmp(a, b) {
    var x = codeKey(a.code), y = codeKey(b.code);
    if (x[0] !== y[0]) return x[0] < y[0] ? -1 : 1;
    if (x[1] !== y[1]) return x[1] - y[1];
    return a.ord - b.ord;
  }

  Logger.log('SHEETS ' + all.map(function (s, i) { return i + ':' + s.getName(); }).join(' / '));

  // ---- ｺｰﾄﾞDB: 初計上月 = 当月 の新規契約
  var dbLast = db.getLastRow();
  var dv = db.getRange(1, 1, dbLast, 18).getValues();
  var dn = db.getRange(1, 7, dbLast, 1).getNotes();
  var newRows = [];
  for (var i = 2; i < dbLast; i++) {
    var c = String(dv[i][3]).trim();
    if (CODE.test(c) && ym(dv[i][1]) === T) newRows.push({ dbRow: i + 1, code: c, v: dv[i], note: dn[i][0] });
  }

  // ---- PTシート読み込み + プレフィックス→シートの多数決
  var pts = all.slice(2).filter(function (s) { return s.getName() !== 'ひながた'; });
  var info = {}, vote = {};
  pts.forEach(function (sh) {
    var n = sh.getName(), lr = Math.max(sh.getLastRow(), 1);
    var rng = sh.getRange(1, 1, lr, 15);
    var v = rng.getValues(), f = rng.getFormulas(), data = [];
    for (var r = 0; r < lr; r++) {
      var code = String(v[r][3]).trim();
      if (!CODE.test(code)) continue;
      data.push(r);
      var p = codeKey(code)[0];
      if (!vote[p]) vote[p] = {};
      if (vote[p][n]) { vote[p][n]++; } else { vote[p][n] = 1; }
    }
    info[n] = { sh: sh, v: v, f: f, data: data };
  });
  function sheetFor(code) {
    if (OVERRIDE[code]) return OVERRIDE[code];
    var p = codeKey(code)[0], best = null, bc = 0;
    if (vote[p]) for (var n in vote[p]) if (vote[p][n] > bc) { best = n; bc = vote[p][n]; }
    if (best) return best;
    // まだ1件も無いプレフィックスは、シート名の頭がプレフィックスのシート(ひながたから作った空シート)
    var re = new RegExp('^' + p + '(?![A-Za-z])');
    for (var j = 0; j < pts.length; j++) if (re.test(pts[j].getName())) return pts[j].getName();
    return null;
  }

  var plan = {}, unmapped = [];
  newRows.forEach(function (x) {
    var n = sheetFor(x.code);
    if (!n) { unmapped.push(x.code); return; }
    if (!plan[n]) plan[n] = [];
    plan[n].push(x);
  });
  Logger.log('NEW(' + newRows.length + ') ' + newRows.map(function (x) { return x.code + '→' + sheetFor(x.code); }).join(', '));
  if (unmapped.length) { Logger.log('UNMAPPED ' + unmapped.join(', ') + ' → OVERRIDE に追加してから再実行'); return; }

  // 空シートの書式見本(データのあるACFシートの最終データ行)
  var refName = sheetFor('ACF-001'), refI = info[refName];
  var fmtRef = refI.sh.getRange(refI.data[refI.data.length - 1] + 1, 1, 1, 15);

  if (!DRY_RUN && BACKUP) {
    var props = PropertiesService.getDocumentProperties(), key = 'backup_' + T;
    if (!props.getProperty(key)) {
      var cp = ss.copy('【バックアップ】PTI支払管理 ' + T + '転記前');
      props.setProperty(key, cp.getId());
      Logger.log('BACKUP ' + cp.getUrl());
    }
  }

  var summary = [], doneDb = [], touched = [], total = 0;
  pts.forEach(function (sh) {
    var n = sh.getName(), I = info[n];
    var already = I.data.filter(function (r) { return ym(I.v[r][2]) === T; });
    if (already.length) { summary.push('SKIP ' + n + ': 当月行が既に' + already.length + '行あり'); return; }

    var entries = [], ord = 0;
    I.data.forEach(function (r) {
      if (ym(I.v[r][2]) === P) entries.push({ kind: 'tpl', r: r, code: String(I.v[r][3]).trim(), ord: ord++ });
    });
    (plan[n] || []).forEach(function (x) { entries.push({ kind: 'new', x: x, code: x.code, ord: ord++ }); });
    if (!entries.length) return;
    entries.sort(cmp);

    var lastData = I.data.length ? I.data[I.data.length - 1] + 1 : 1;   // 1始まり。空シートは見出し行
    var start = lastData + 1;
    var prevA = I.data.length ? Number(I.v[lastData - 1][0]) : 0;
    if (isNaN(prevA)) prevA = lastData;

    var out = [];
    entries.forEach(function (e, k) {
      var row = start + k, a, o;
      if (e.kind === 'tpl') {
        var s = I.v[e.r], sf = I.f[e.r];
        var L = sf[11] && sf[11].charAt(0) === '=' ? '=H' + row + '*K' + row : s[11];
        a = [s[1], TDATE, s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], L];
        o = '';
      } else {
        var d = e.x.v;
        var L2 = SPECIAL[e.code] != null ? SPECIAL[e.code] : '=H' + row + '*K' + row;
        a = [d[0], TDATE, e.code, d[5], d[7], d[8], d[9], d[10], d[11], d[12], L2];
        o = String(d[6]).trim() === '複数' ? (e.x.note || '複数') : (d[6] || '');
      }
      var M = row === 2 && !I.data.length ? '=L' + row : '=M' + (row - 1) + '+L' + row;
      out.push([prevA + k + 1].concat(a, [M, '=EDATE(C' + row + ',1)', o]));
    });

    total += out.length;
    summary.push(n + ': +' + out.length + '行 (' + start + '〜' + (start + out.length - 1) + ')' +
      ((plan[n] || []).length ? ' 新規 ' + plan[n].map(function (x) { return x.code; }).join(',') : ''));
    (plan[n] || []).forEach(function (x) { doneDb.push(x.dbRow); });
    touched.push({ sh: sh, start: start, len: out.length });
    if (DRY_RUN) return;

    var dst = sh.getRange(start, 1, out.length, 15);
    (I.data.length ? sh.getRange(lastData, 1, 1, 15) : fmtRef).copyTo(dst, { formatOnly: true });
    dst.setValues(out);
    sh.getRange(start, 2, out.length, 2).setNumberFormat('yyyy/mm');
    sh.getRange(start, 10, out.length, 1).setNumberFormat('m/d');
    sh.getRange(start, 3, out.length, 1).setBackground(PURPLE);
    sh.getRange(start, 13, out.length, 1).setBackground(null);
    for (var k = 0; k < out.length; k++) {
      if (out[k][14]) sh.getRange(start + k, 15).setWrap(true).setVerticalAlignment('middle');
    }
  });

  if (!DRY_RUN) {
    doneDb.forEach(function (r) { db.getRange(r, 6).setBackground(GREEN); });
    SpreadsheetApp.flush();
    touched.forEach(function (t) {
      var last = t.start + t.len - 1;
      var m = Number(t.sh.getRange(last, 13).getValue());
      t.sh.getRange(last, 13).setBackground(m >= 10000 ? CYAN : PURPLE);
      var disp = t.sh.getRange(t.start, 1, t.len, 15).getDisplayValues();
      var bad = disp.filter(function (row) { return row.join('|').indexOf('#') >= 0; }).length;
      if (bad) summary.push('ERROR ' + t.sh.getName() + ': エラー表示の行が' + bad + '行');
    });
  }

  Logger.log((DRY_RUN ? '[DRY_RUN] ' : '[LIVE] ') + T + ' 計上分 合計 ' + total + '行 / ｺｰﾄﾞDB緑 ' + doneDb.length + '行\n' + summary.join('\n'));
}
