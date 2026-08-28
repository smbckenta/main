/*
 * ひな形 (template/ev-hikaku-template.xlsx) に案件データを流し込んで
 * 「EV保守 価格比較表」の xlsx を組み立てる。
 *
 * ひな形の書式・ロゴ・印刷設定はそのまま使い、次の3点だけを書き換える:
 *   1. ヘッダー (宛先・作成者・タイトル・日付)
 *   2. 明細行 (ひな形は8行固定。行ペアを複製／削除して任意件数に合わせる)
 *   3. 合計・削減・備考 (明細の増減に合わせて行番号と数式をずらす)
 */
(function (global) {
  'use strict';

  var TEMPLATE_ROWS = 8;        // ひな形が持つ明細行数
  var FIRST_DATA_ROW = 16;      // 明細1件目の上段
  var DATA_ROW_SPAN = 2;        // 1件は2行で構成される

  // 明細の列割り当て（値を入れるのは結合セルの左上だけ）
  var LEFT = {
    no: 'A', site: 'B', maker: 'J', qty: 'P', vendor: 'U',
    freq: 'Z', spec: 'AE', stops: 'AJ', plan: 'AO', price: 'AT'
  };
  var RIGHT = {
    maker: 'BG', qty: 'BM', vendor: 'BR', freq: 'BZ',
    spec: 'CE', plan: 'CJ', price: 'CO'
  };

  // 提案側「契約内容」は現行と変わる場合に赤字にする。ひな形が両方の書式を持っている。
  var PLAN_STYLE = {
    emphasis: { top: { CJ: 127, CK: 128, CL: 128, CM: 128, CN: 129 },
                bottom: { CJ: 130, CK: 131, CL: 131, CM: 131, CN: 132 } },
    plain:    { top: { CJ: 140, CK: 141, CL: 141, CM: 141, CN: 142 },
                bottom: { CJ: 143, CK: 144, CL: 144, CM: 144, CN: 145 } }
  };

  function colToNum(col) {
    var n = 0;
    for (var i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  // 1899-12-30 起点のシリアル値。Excel の日付書式セルに入れる。
  function dateSerial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Math.round(utc / 86400000) + 25569;
  }

  // sheetData を <row> 単位に切り出す。属性に '>' は現れないので単純走査でよい。
  function splitRows(sd) {
    var rows = [];
    var i = 0;
    while (true) {
      var start = sd.indexOf('<row ', i);
      if (start < 0) break;
      var tagEnd = sd.indexOf('>', start);
      var selfClosing = sd[tagEnd - 1] === '/';
      var end;
      if (selfClosing) {
        end = tagEnd + 1;
      } else {
        var close = sd.indexOf('</row>', tagEnd);
        end = close + '</row>'.length;
      }
      var xml = sd.slice(start, end);
      var num = parseInt(/r="(\d+)"/.exec(xml)[1], 10);
      rows.push({ n: num, xml: xml });
      i = end;
    }
    return rows;
  }

  // 行内の 1 セルを丸ごと差し替える。値なし(undefined)なら空セルにする。
  function setCell(rowXml, addr, opts) {
    opts = opts || {};
    var re = new RegExp('<c r="' + addr + '"(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</c>)');
    var m = re.exec(rowXml);
    if (!m) return rowXml;

    var style = opts.style;
    if (style === undefined) {
      var sm = /\ss="(\d+)"/.exec(m[0]);
      style = sm ? sm[1] : null;
    }
    var attrs = '<c r="' + addr + '"' + (style === null ? '' : ' s="' + style + '"');
    var body;
    if (opts.formula !== undefined && opts.formula !== null) {
      body = '><f>' + esc(opts.formula) + '</f></c>';
    } else if (opts.number !== undefined && opts.number !== null && opts.number !== '') {
      body = '><v>' + opts.number + '</v></c>';
    } else if (opts.text !== undefined && opts.text !== null && opts.text !== '') {
      attrs += ' t="inlineStr"';
      body = '><is><t xml:space="preserve">' + esc(opts.text) + '</t></is></c>';
    } else {
      body = '/>';
    }
    return rowXml.slice(0, m.index) + attrs + body + rowXml.slice(m.index + m[0].length);
  }

  // 数値として書けるものは数値、それ以外は文字列として書く。
  function setValue(rowXml, addr, value, style) {
    if (value === null || value === undefined || value === '') {
      return setCell(rowXml, addr, { style: style });
    }
    if (typeof value === 'number' && isFinite(value)) {
      return setCell(rowXml, addr, { number: value, style: style });
    }
    var s = String(value).trim();
    if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) {
      return setCell(rowXml, addr, { number: Number(s), style: style });
    }
    return setCell(rowXml, addr, { text: s, style: style });
  }

  // 行番号を書き換える。セル参照 (r="AT32") と行 (r="32") の両方が対象。
  function renumberRow(rowXml, from, to) {
    if (from === to) return rowXml;
    return rowXml
      .replace(/^<row ([^>]*?)r="\d+"/, '<row $1r="' + to + '"')
      .replace(new RegExp('r="([A-Z]+)' + from + '"', 'g'), 'r="$1' + to + '"');
  }

  // 数式中のセル参照の行番号をずらす。$ 付き絶対参照にも対応する。
  function shiftFormulas(rowXml, mapRow) {
    return rowXml.replace(/<f([^>]*)>([\s\S]*?)<\/f>/g, function (all, attr, body) {
      var moved = body.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, function (m, d1, col, d2, row) {
        return d1 + col + d2 + mapRow(parseInt(row, 10));
      });
      return '<f' + attr + '>' + moved + '</f>';
    });
  }

  // 数式を持つセルのキャッシュ値を捨てる。workbook 側で開いたときに再計算させる。
  function dropCachedValues(rowXml) {
    return rowXml.replace(/(<\/f>)<v>[\s\S]*?<\/v>/g, '$1');
  }

  function buildDataRow(topTpl, bottomTpl, index, row, opts) {
    var top = renumberRow(topTpl, FIRST_DATA_ROW, FIRST_DATA_ROW + index * DATA_ROW_SPAN);
    var bottom = renumberRow(bottomTpl, FIRST_DATA_ROW + 1, FIRST_DATA_ROW + 1 + index * DATA_ROW_SPAN);
    var rTop = FIRST_DATA_ROW + index * DATA_ROW_SPAN;
    var rBottom = rTop + 1;

    top = dropCachedValues(top);
    bottom = dropCachedValues(bottom);

    top = setValue(top, LEFT.no + rTop, index + 1);
    top = setValue(top, LEFT.site + rTop, row.site);
    top = setValue(top, LEFT.maker + rTop, row.currentMaker);
    top = setValue(top, LEFT.qty + rTop, row.currentQty);
    top = setValue(top, LEFT.vendor + rTop, row.currentVendor);
    top = setValue(top, LEFT.freq + rTop, row.currentFrequency);
    top = setValue(top, LEFT.spec + rTop, row.currentSpec);
    top = setValue(top, LEFT.stops + rTop, row.stops);
    top = setValue(top, LEFT.plan + rTop, row.currentPlan);
    top = setValue(top, LEFT.price + rTop, row.currentMonthly);

    top = setValue(top, RIGHT.maker + rTop, row.proposalMaker);
    top = setValue(top, RIGHT.qty + rTop, row.proposalQty);
    top = setValue(top, RIGHT.vendor + rTop, row.proposalVendor);
    top = setValue(top, RIGHT.freq + rTop, row.proposalFrequency);
    top = setValue(top, RIGHT.spec + rTop, row.proposalSpec);
    top = setValue(top, RIGHT.plan + rTop, row.proposalPlan);
    top = setValue(top, RIGHT.price + rTop, row.proposalMonthly);

    // 契約内容が現行から変わる行だけ赤字にする（ひな形と同じ見せ方）
    var emphasize = opts.emphasizePlanChange
      ? String(row.proposalPlan || '') !== String(row.currentPlan || '') && !!row.proposalPlan
      : false;
    if (row.emphasizePlan === true) emphasize = true;
    if (row.emphasizePlan === false) emphasize = false;
    var styles = emphasize ? PLAN_STYLE.emphasis : PLAN_STYLE.plain;
    Object.keys(styles.top).forEach(function (col) {
      top = top.replace(new RegExp('<c r="' + col + rTop + '"\\s+s="\\d+"'),
        '<c r="' + col + rTop + '" s="' + styles.top[col] + '"');
    });
    Object.keys(styles.bottom).forEach(function (col) {
      bottom = bottom.replace(new RegExp('<c r="' + col + rBottom + '"\\s+s="\\d+"'),
        '<c r="' + col + rBottom + '" s="' + styles.bottom[col] + '"');
    });

    return top + bottom;
  }

  function parseRef(ref) {
    var m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
    if (!m) return null;
    return {
      c1: m[1], r1: +m[2],
      c2: m[3] || m[1], r2: m[4] ? +m[4] : +m[2]
    };
  }

  function buildMergeCells(originalXml, count, delta, lastDataRow) {
    var refs = [];
    var re = /<mergeCell ref="([^"]+)"\/>/g;
    var m;
    var dataTemplates = [];
    while ((m = re.exec(originalXml))) {
      var p = parseRef(m[1]);
      if (!p) continue;
      if (p.r2 <= FIRST_DATA_ROW - 1) {
        refs.push(m[1]);
      } else if (p.r1 === FIRST_DATA_ROW && p.r2 === FIRST_DATA_ROW + 1) {
        dataTemplates.push(p);
      } else if (p.r1 >= FIRST_DATA_ROW && p.r2 <= FIRST_DATA_ROW + TEMPLATE_ROWS * DATA_ROW_SPAN - 1) {
        // 2件目以降の明細の結合は作り直すので捨てる
      } else {
        refs.push(p.c1 + (p.r1 + delta) + ':' + p.c2 + (p.r2 + delta));
      }
    }
    for (var i = 0; i < count; i++) {
      var off = i * DATA_ROW_SPAN;
      dataTemplates.forEach(function (p) {
        refs.push(p.c1 + (p.r1 + off) + ':' + p.c2 + (p.r2 + off));
      });
    }
    return '<mergeCells count="' + refs.length + '">' +
      refs.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join('') +
      '</mergeCells>';
  }

  // 提案→現行の矢印図形が明細ブロックの中央付近に来るよう、行アンカーを寄せる
  function shiftArrowAnchor(drawingXml, count) {
    var lastData0 = FIRST_DATA_ROW - 2 + count * DATA_ROW_SPAN; // 0 起点の最終明細行
    var from0 = Math.min(Math.max(count + 10, FIRST_DATA_ROW - 1), lastData0);
    var to0 = Math.min(from0 + 5, lastData0 + 1);
    var seen = 0;
    return drawingXml.replace(
      /<xdr:twoCellAnchor>([\s\S]*?)<\/xdr:twoCellAnchor>/g,
      function (all, body) {
        seen++;
        var moved = body
          .replace(/(<xdr:from>[\s\S]*?<xdr:row>)\d+(<\/xdr:row>)/, '$1' + from0 + '$2')
          .replace(/(<xdr:to>[\s\S]*?<xdr:row>)\d+(<\/xdr:row>)/, '$1' + to0 + '$2');
        return '<xdr:twoCellAnchor>' + moved + '</xdr:twoCellAnchor>';
      }
    );
  }

  function fill(templateBytes, model) {
    var zip = MiniZip.read(templateBytes);
    var dec = new TextDecoder();
    var enc = new TextEncoder();

    var rows = (model.rows || []).slice();
    if (!rows.length) rows = [{}];
    var count = rows.length;
    var delta = (count - TEMPLATE_ROWS) * DATA_ROW_SPAN;
    var lastDataRow = FIRST_DATA_ROW - 1 + count * DATA_ROW_SPAN;
    var years = model.years || 10;

    function mapRow(r) {
      if (r >= FIRST_DATA_ROW + TEMPLATE_ROWS * DATA_ROW_SPAN) return r + delta;
      if (r === FIRST_DATA_ROW + TEMPLATE_ROWS * DATA_ROW_SPAN - 1) return lastDataRow;
      return r;
    }

    var sheet = dec.decode(zip.files['xl/worksheets/sheet1.xml']);
    var sdOpen = sheet.indexOf('<sheetData>');
    var sdClose = sheet.indexOf('</sheetData>');
    var head = sheet.slice(0, sdOpen + '<sheetData>'.length);
    var tail = sheet.slice(sdClose);
    var body = sheet.slice(sdOpen + '<sheetData>'.length, sdClose);

    var srcRows = splitRows(body);
    var byNum = {};
    srcRows.forEach(function (r) { byNum[r.n] = r.xml; });

    var out = [];
    srcRows.forEach(function (r) {
      var n = r.n;
      if (n < FIRST_DATA_ROW) {
        out.push(patchHeaderRow(r.xml, n, model));
        return;
      }
      if (n === FIRST_DATA_ROW) {
        for (var i = 0; i < count; i++) {
          out.push(buildDataRow(byNum[FIRST_DATA_ROW], byNum[FIRST_DATA_ROW + 1], i, rows[i], {
            emphasizePlanChange: model.emphasizePlanChange !== false
          }));
        }
        return;
      }
      if (n < FIRST_DATA_ROW + TEMPLATE_ROWS * DATA_ROW_SPAN) return; // ひな形の残り明細行は捨てる

      var xml = renumberRow(r.xml, n, n + delta);
      xml = shiftFormulas(xml, mapRow);
      xml = dropCachedValues(xml);
      xml = patchSummaryRow(xml, n, n + delta, model, years);
      out.push(xml);
    });

    var newSheet = head + out.join('') + tail;
    newSheet = newSheet.replace(/<dimension ref="A1:([A-Z]+)\d+"\/>/,
      '<dimension ref="A1:$1' + (77 + delta) + '"/>');
    newSheet = newSheet.replace(/<mergeCells count="\d+">[\s\S]*?<\/mergeCells>/,
      buildMergeCells(sheet, count, delta, lastDataRow));
    zip.files['xl/worksheets/sheet1.xml'] = enc.encode(newSheet);

    var drawing = dec.decode(zip.files['xl/drawings/drawing1.xml']);
    zip.files['xl/drawings/drawing1.xml'] = enc.encode(shiftArrowAnchor(drawing, count));

    var wb = dec.decode(zip.files['xl/workbook.xml']);
    var sheetName = (model.sheetName || '比較表').replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31);
    wb = wb.replace(/<sheet name="[^"]*"/, '<sheet name="' + esc(sheetName) + '"');
    wb = wb.replace(/>[^<]*!\$A\$1:\$CY\$\d+</, '>' + esc(sheetName) + '!$A$1:$CY$' + (78 + delta) + '<');
    zip.files['xl/workbook.xml'] = enc.encode(wb);

    return MiniZip.write(zip.names.map(function (n) {
      return { name: n, data: zip.files[n] };
    }));
  }

  function patchHeaderRow(xml, n, model) {
    var issuer = model.issuer || {};
    if (n === 1) {
      var serial = dateSerial(model.date);
      xml = serial
        ? setCell(xml, 'CV1', { number: serial })
        : setCell(xml, 'CV1', { formula: 'TODAY()' });
    }
    if (n === 3) xml = setValue(xml, 'AL3', model.title || 'EV保守 価格比較表');
    if (n === 6) {
      xml = setValue(xml, 'B6', model.customer || '');
      xml = setValue(xml, 'BX6', issuer.line1 || '');
    }
    if (n === 7) xml = setValue(xml, 'BX7', issuer.line2 || '');
    if (n === 8) xml = setValue(xml, 'BX8', issuer.line3 || '');
    if (n === 9) xml = setValue(xml, 'BX9', issuer.line4 || '');
    if (n === 12) xml = setValue(xml, 'B12', model.sectionTitle || '-  エ レ ベ ー タ ー 料 金 詳 細 内 訳  - ');
    return dropCachedValues(xml);
  }

  function patchSummaryRow(xml, original, shifted, model, years) {
    var rates = model.profitRates || [0.2, 0.1, 0.05];
    if (original === 44) {
      xml = setValue(xml, 'Y' + shifted, '合計金額　（' + years + '年間）');
      xml = setValue(xml, 'BY' + shifted, '合計金額　（' + years + '年間）');
    }
    if (original === 45) {
      xml = setCell(xml, 'Y' + shifted, { formula: 'Y' + (42 + (shifted - original)) + '*' + years });
      xml = setCell(xml, 'BY' + shifted, { formula: 'BY' + (42 + (shifted - original)) + '*' + years });
    }
    if (original === 53) {
      ['BH', 'BM', 'BR'].forEach(function (col, i) {
        xml = setCell(xml, col + shifted, { number: rates[i] });
      });
    }
    if (original === 54) {
      var annual = 55 + (shifted - original);
      ['BH', 'BM', 'BR'].forEach(function (col, i) {
        var factor = rates[i] ? Math.round(1 / rates[i] * 100) / 100 : 0;
        xml = setCell(xml, col + shifted, { formula: '$BY$' + annual + '*-' + factor });
      });
    }
    if (original === 57) {
      xml = setValue(xml, 'BY' + shifted, '合計合算削減金額　（' + years + '年間）');
    }
    if (original === 58) {
      xml = setCell(xml, 'BY' + shifted, { formula: 'BY' + (55 + (shifted - original)) + '*' + years });
    }
    if (original === 68 && model.remarks !== undefined) {
      xml = setValue(xml, 'D' + shifted, model.remarks);
    }
    return xml;
  }

  global.XlsxFill = { fill: fill, dateSerial: dateSerial };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  if (typeof globalThis.MiniZip === 'undefined') require('./zip.js');
  module.exports = globalThis.XlsxFill;
}
