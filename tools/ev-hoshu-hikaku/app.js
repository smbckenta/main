/*
 * EV保守 価格比較表 作成ツール
 *
 * 流れ: 書類を読ませる → 明細を直す → 表紙を整える → 比較表を出す
 * 保存先は Google ドライブ上の data フォルダ（複合機ツールと同じ置き方）。
 */
(function () {
  'use strict';

  var DEFAULT_REMARKS = [
    '・上記金額はすべて年1回の法定検査も含まれた金額となります。',
    '・上記ランニングコストに加え、約25年周期のリニューアル工事費用につきましては、メーカー系保守ベンダー対比で独立系保守ベンダーは30％-40％程度削減できる見込みです。',
    '※原則、現在の契約内容と同条件にて価格の比較をしております。点検条件、その他オプション等につきましてはお見積をご覧くださいませ。'
  ].join('\n');

  var DEFAULT_SETTINGS = {
    issuer: {
      line1: 'ＥＶパートナーズ株式会社',
      line2: '〒830-0044　福岡県久留米市本町2-23　栗原ビルディング4F',
      line3: 'TEL：0942-64-9035　　FAX：0942-64-9036',
      line4: '担当:'
    },
    defaults: {
      title: 'EV保守 価格比較表',
      sheetName: '比較表',
      sectionTitle: '-  エ レ ベ ー タ ー 料 金 詳 細 内 訳  - ',
      years: 10,
      profitRates: [0.2, 0.1, 0.05],
      proposalVendor: 'エレベーターコミュニケーションズ㈱',
      proposalFrequency: '有人点検\n1回/2ヶ月',
      proposalSpec: '遠隔監視装置付き\nQRサポート付き',
      proposalPlan: 'FM契約',
      discountRate: 0.2,
      remarks: DEFAULT_REMARKS
    },
    ai: { enabled: true, model: 'claude-opus-5' }
  };

  var App = {
    settings: null,
    apiKey: '',
    templateBytes: null,
    index: [],        // 一覧用の軽い情報
    current: null,    // 開いている案件
    pending: [],      // 読み取り待ちのファイル
    lastExtract: null,
    dirty: false
  };

  // ---------- 小さな道具 ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function todayIso() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('ja-JP');
  }

  function round100(n) { return Math.round(Number(n || 0) / 100) * 100; }

  function toast(message, isError) {
    var box = document.createElement('div');
    if (isError) box.className = 'err';
    box.textContent = message;
    $('#toast').appendChild(box);
    setTimeout(function () { box.remove(); }, isError ? 8000 : 3200);
  }

  function fail(e) {
    console.error(e);
    toast(e && e.message ? e.message : String(e), true);
  }

  // ---------- 設定とデータフォルダ ----------
  function mergeDefaults(loaded) {
    var s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (!loaded) return s;
    if (loaded.issuer) Object.assign(s.issuer, loaded.issuer);
    if (loaded.defaults) Object.assign(s.defaults, loaded.defaults);
    if (loaded.ai) Object.assign(s.ai, loaded.ai);
    return s;
  }

  async function connect(viaPicker) {
    var dir = viaPicker ? await Store.pick() : (await Store.restore()) || (await Store.reauthorize());
    if (!dir) return false;
    await afterConnect();
    return true;
  }

  async function afterConnect() {
    App.settings = mergeDefaults(await Store.readJson('settings.json', null));
    if (!(await Store.exists('settings.json'))) {
      await Store.writeJson('settings.json', App.settings);
    }
    App.apiKey = (await Store.readText('api-key.txt').catch(function () { return ''; })).trim();
    App.templateBytes = (await Store.exists('template.xlsx'))
      ? await Store.readBytes('template.xlsx')
      : await adoptBundledTemplate();
    await refreshIndex();
    renderChip();
    renderCaseList();
    renderAll();
  }

  function renderChip() {
    var chip = $('#dataChip');
    if (Store.connected()) {
      chip.className = 'chip';
      chip.textContent = 'data: ' + Store.name();
      $('#connectBtn').textContent = 'フォルダを切り替え';
    } else {
      chip.className = 'chip off';
      chip.textContent = 'データフォルダ未接続';
    }
  }

  async function refreshIndex() {
    var names = await Store.listDir('cases');
    var list = [];
    for (var i = 0; i < names.length; i++) {
      if (!/\.json$/.test(names[i])) continue;
      var c = await Store.readJson('cases/' + names[i], null);
      if (!c) continue;
      list.push({
        id: c.id, title: c.title, customerName: c.customerName,
        caseDate: c.caseDate, updatedAt: c.updatedAt, rowCount: (c.rows || []).length
      });
    }
    list.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
    App.index = list;
  }

  // ---------- 案件 ----------
  function newRow(settings) {
    var d = settings.defaults;
    return {
      id: uuid(),
      site: '', currentMaker: '', currentQty: 1, currentVendor: '',
      currentFrequency: '', currentSpec: '遠隔監視装置付き', stops: '',
      currentPlan: '', currentMonthly: '',
      proposalMaker: '', proposalQty: 1, proposalVendor: d.proposalVendor,
      proposalFrequency: d.proposalFrequency, proposalSpec: d.proposalSpec,
      proposalPlan: d.proposalPlan, proposalMonthly: '',
      emphasizePlan: null
    };
  }

  function newCase() {
    var d = App.settings.defaults;
    var now = new Date().toISOString();
    return {
      id: uuid(),
      title: d.title,
      sheetName: d.sheetName,
      sectionTitle: d.sectionTitle,
      customerName: '',
      customerHonorific: '御中',
      caseDate: todayIso(),
      years: d.years,
      profitRates: d.profitRates.slice(),
      issuer: Object.assign({}, App.settings.issuer),
      remarks: d.remarks,
      rows: [newRow(App.settings)],
      units: [],
      ingest: [],
      files: [],
      warnings: [],
      createdAt: now,
      updatedAt: now
    };
  }

  async function saveCurrent() {
    if (!App.current || !Store.connected()) return;
    App.current.updatedAt = new Date().toISOString();
    await Store.writeJson('cases/' + App.current.id + '.json', App.current);
    App.dirty = false;
    await refreshIndex();
    renderCaseList();
  }

  var saveTimer = null;
  function touch() {
    App.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveCurrent().catch(fail); }, 800);
  }

  async function openCase(id) {
    var c = await Store.readJson('cases/' + id + '.json', null);
    if (!c) return fail(new Error('案件を読み込めませんでした'));
    if (!c.rows || !c.rows.length) c.rows = [newRow(App.settings)];
    c.rows.forEach(function (r) { if (!r.id) r.id = uuid(); });
    // 台帳を持たない古い案件も開けるようにしておく
    if (!c.units) c.units = [];
    c.units.forEach(function (u) {
      if (!u.id) u.id = uuid();
      if (!u.renewals) u.renewals = [];
      if (!u.findings) u.findings = [];
    });
    App.current = c;
    App.lastExtract = null;
    App.pending = [];
    renderCaseList();
    renderAll();
  }

  async function deleteCase(id) {
    if (!confirm('この案件を削除します。よろしいですか？')) return;
    await Store.remove('cases/' + id + '.json');
    if (App.current && App.current.id === id) App.current = null;
    await refreshIndex();
    renderCaseList();
    renderAll();
  }

  // ---------- 左の一覧 ----------
  function renderCaseList() {
    var q = ($('#caseSearch').value || '').trim();
    var ul = $('#caseList');
    ul.innerHTML = '';
    App.index
      .filter(function (c) {
        if (!q) return true;
        return ((c.title || '') + (c.customerName || '')).indexOf(q) >= 0;
      })
      .forEach(function (c) {
        var li = document.createElement('li');
        if (App.current && App.current.id === c.id) li.className = 'on';
        li.innerHTML =
          '<div class="t">' + esc(c.customerName || '（お客様名なし）') + '</div>' +
          '<div class="m">' + esc(c.caseDate || '') + '　' + c.rowCount + '件</div>';
        li.onclick = function () { openCase(c.id).catch(fail); };
        ul.appendChild(li);
      });
  }

  // ---------- 画面切り替え ----------
  function renderAll() {
    renderRead();
    renderUnits();
    renderRows();
    renderCover();
    renderPreview();
  }

  function needCase(host) {
    if (Store.connected() && App.current) return false;
    host.innerHTML = '<div class="empty">' +
      (Store.connected()
        ? '左の「＋ 新規案件」から始めてください。'
        : '上の「データフォルダを接続」で、Google ドライブ上の data フォルダを選んでください。') +
      '</div>';
    return true;
  }

  // ---------- ① 書類読み取り ----------
  function renderRead() {
    var host = $('#readBody');
    if (needCase(host)) return;
    var c = App.current;

    host.innerHTML =
      '<div class="card">' +
      '<h2>書類を読み取る</h2>' +
      '<div id="drop" class="drop">定期検査報告書・保守契約書（PDF / 画像）をここにドラッグ<br>' +
      'または<button id="pickFiles" class="btn" style="margin-top:8px">ファイルを選ぶ</button></div>' +
      '<ul id="pendingList" class="filelist"></ul>' +
      '<div style="margin-top:14px; display:flex; gap:10px; align-items:center">' +
      '<button id="analyzeBtn" class="btn primary">Claude で読み取る</button>' +
      '<span class="hint" id="analyzeHint"></span></div>' +
      '<p class="hint">読み取り結果はそのまま採用せず、根拠と警告を確認してから明細に取り込んでください。</p>' +
      '</div>' +
      '<div id="extractBody"></div>' +
      (c.ingest && c.ingest.length
        ? '<div class="card"><h2>この案件で読み取った書類</h2>' +
          '<ul class="filelist">' + c.ingest.map(function (d) {
            return '<li>' + esc(d.fileName || '') + '<span class="badge">' + esc(d.docType || '') + '</span>' +
              '<span class="sz">' + esc((d.parsedAt || '').slice(0, 10)) + '</span></li>';
          }).join('') + '</ul></div>'
        : '');

    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hot'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('hot'); });
    });
    drop.addEventListener('drop', function (e) {
      addPending(Array.prototype.slice.call(e.dataTransfer.files));
    });
    $('#pickFiles').onclick = function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.pdf,image/*';
      input.onchange = function () { addPending(Array.prototype.slice.call(input.files)); };
      input.click();
    };
    $('#analyzeBtn').onclick = function () { analyze().catch(fail); };
    renderPending();
    if (App.lastExtract) renderExtract(App.lastExtract);
  }

  function addPending(files) {
    files.forEach(function (f) { App.pending.push(f); });
    renderPending();
  }

  function renderPending() {
    var ul = $('#pendingList');
    if (!ul) return;
    ul.innerHTML = App.pending.map(function (f, i) {
      return '<li>' + esc(f.name) +
        '<span class="sz">' + Math.round(f.size / 1024) + ' KB</span>' +
        '<button class="btn ghost" data-rm="' + i + '">×</button></li>';
    }).join('');
    $$('[data-rm]', ul).forEach(function (b) {
      b.onclick = function () {
        App.pending.splice(Number(b.dataset.rm), 1);
        renderPending();
      };
    });
    var btn = $('#analyzeBtn');
    if (btn) btn.disabled = !App.pending.length;
    var hint = $('#analyzeHint');
    if (hint) {
      hint.textContent = !App.apiKey
        ? 'data/api-key.txt に API キーを置いてください'
        : App.pending.length ? App.pending.length + ' 件を読み取ります' : '';
    }
  }

  async function analyze() {
    if (!App.pending.length) return;
    var btn = $('#analyzeBtn');
    btn.disabled = true;
    btn.textContent = '読み取り中…';
    try {
      var payload = [];
      for (var i = 0; i < App.pending.length; i++) {
        var f = App.pending[i];
        payload.push({ file: f, bytes: new Uint8Array(await f.arrayBuffer()) });
      }
      var result = await Ai.extract(payload, {
        apiKey: App.apiKey,
        model: (App.settings.ai && App.settings.ai.model) || 'claude-opus-5'
      });
      App.lastExtract = result;

      // 元ファイルを案件フォルダに残しておく（後から根拠をたどれるように）
      for (var j = 0; j < payload.length; j++) {
        await Store.write('uploads/' + App.current.id + '/' + payload[j].file.name, payload[j].bytes);
      }
      var stamp = new Date().toISOString();
      result.documents.forEach(function (d) {
        App.current.ingest.push(Object.assign({}, d, { parsedAt: stamp }));
        (d.warnings || []).forEach(function (w) {
          App.current.warnings.push(d.fileName + ': ' + w);
        });
      });
      App.pending = [];
      await saveCurrent();
      renderRead();
      toast(result.documents.length + ' 件の書類を読み取りました');
    } catch (e) {
      fail(e);
    } finally {
      var b = $('#analyzeBtn');
      if (b) { b.disabled = false; b.textContent = 'Claude で読み取る'; }
    }
  }

  function renderExtract(result) {
    var host = $('#extractBody');
    if (!host) return;
    host.innerHTML =
      '<div class="card"><h2>読み取り結果</h2>' +
      result.documents.map(function (d, i) { return docHtml(d, i); }).join('') +
      '<div style="margin-top:12px"><button id="importBtn" class="btn primary">明細に取り込む</button>' +
      '<span class="hint" style="margin-left:10px">同じ設置場所は1行にまとめます。既存の行は上書きしません。</span></div>' +
      '</div>';
    $('#importBtn').onclick = function () {
      importDocuments(result.documents);
    };
  }

  function docHtml(d, i) {
    var conf = Number(d.confidence || 0);
    var rows = [
      ['書類の種類', d.docType],
      ['設置場所', d.buildingName],
      ['所在地', d.buildingAddress],
      ['契約者', d.owner],
      ['保守ベンダー', d.vendor],
      ['契約種別', d.planLabel || d.planType],
      ['台数', d.unitCount],
      ['点検頻度', d.inspectionFrequency],
      ['仕様', d.spec],
      ['月額保守料金', d.monthlyFee == null ? '' : money(d.monthlyFee) + '円' +
        (d.monthlyFeeTaxIncluded ? '（税込）' : '（税抜）')],
      ['契約期間', [d.termFrom, d.termTo].filter(Boolean).join(' 〜 ')],
      ['解約予告', d.cancellationNotice],
      ['法定検査費用', d.statutoryInspectionIncluded == null ? '' : (d.statutoryInspectionIncluded ? '月額に含む' : '別途')]
    ].filter(function (kv) { return kv[1] !== '' && kv[1] != null; });

    var units = (d.units || []).map(function (u) {
      var findings = (u.findings || []).filter(function (f) { return f.rank !== '指摘なし'; });
      var a = Lifecycle.assess(u);
      var age = a.elapsed
        ? '　<b>' + esc(Lifecycle.BASIS_LABEL[a.basis]) + ' ' + esc(Lifecycle.both(a.baseOn)) +
          ' / 経過 ' + a.elapsed.years + '年' + a.elapsed.months + 'ヶ月</b>' +
          (a.alert ? ' <span class="state bad">' + a.cycleYears + '年経過</span>' : '')
        : '';
      return '<li>' + esc([u.unitNo, u.maker, u.model].filter(Boolean).join(' / ')) +
        (u.stops ? '　停止階数 ' + u.stops : '') +
        (u.inspectionDate ? '　検査日 ' + esc(u.inspectionDate) : '') +
        age +
        (findings.length
          ? '<div class="warn">' + findings.map(function (f) {
              return '【' + esc(f.rank) + '】' + esc(f.item) + (f.detail ? '：' + esc(f.detail) : '');
            }).join('<br>') + '</div>'
          : '') +
        '</li>';
    }).join('');

    return '<details class="doc"' + (i === 0 ? ' open' : '') + '>' +
      '<summary>' + esc(d.fileName || '(名前なし)') +
      '<span class="badge' + (conf < 0.7 ? ' low' : '') + '">確度 ' + Math.round(conf * 100) + '%</span></summary>' +
      '<div class="in">' +
      '<dl class="kv">' + rows.map(function (kv) {
        return '<dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd>';
      }).join('') + '</dl>' +
      (units ? '<h3 style="font-size:12px;margin:14px 0 6px">号機</h3><ul style="margin:0;padding-left:18px">' + units + '</ul>' : '') +
      ((d.warnings || []).length
        ? '<div class="warn">' + d.warnings.map(esc).join('<br>') + '</div>' : '') +
      ((d.evidence || []).length
        ? '<div class="evi">' + d.evidence.map(esc).join('\n') + '</div>' : '') +
      '</div></details>';
  }

  // 読み取り結果を設置場所ごとにまとめて明細行にする
  function importDocuments(documents) {
    var c = App.current;
    var d = App.settings.defaults;
    var bySite = {};

    documents.forEach(function (doc) {
      var site = (doc.buildingName || '').trim() || (doc.fileName || '').replace(/\.[^.]+$/, '');
      var acc = bySite[site] || (bySite[site] = { site: site, makers: [], stops: [] });
      (doc.units || []).forEach(function (u) {
        if (u.maker) acc.makers.push(u.maker);
        if (u.stops) acc.stops.push(Number(u.stops));
      });
      if (doc.vendor) acc.vendor = doc.vendor;
      if (doc.planType && doc.planType !== '不明') acc.plan = doc.planType;
      if (doc.inspectionFrequency) acc.frequency = doc.inspectionFrequency;
      if (doc.spec) acc.spec = doc.spec;
      if (doc.monthlyFee != null) {
        acc.monthly = doc.monthlyFee;
        acc.taxIncluded = !!doc.monthlyFeeTaxIncluded;
      }
      var count = doc.unitCount || (doc.units || []).length;
      if (count) acc.qty = Math.max(acc.qty || 0, count);
    });

    var added = 0;
    Object.keys(bySite).forEach(function (site) {
      var a = bySite[site];
      var row = c.rows.filter(function (r) { return (r.site || '').trim() === site; })[0];
      var isNew = !row;
      if (isNew) {
        row = newRow(App.settings);
        row.site = site;
        c.rows.push(row);
        added++;
      }
      // 新しく作った行は読み取り値で埋める。既にある行は空欄だけ補う。
      var fill = function (key, value) {
        if (value === undefined || value === null || value === '') return;
        if (isNew || !row[key]) row[key] = value;
      };
      var makers = a.makers.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      fill('currentMaker', makers.join('/'));
      fill('currentVendor', a.vendor);
      fill('currentPlan', a.plan);
      fill('currentFrequency', a.frequency);
      fill('currentSpec', a.spec);
      fill('stops', a.stops.length ? Math.max.apply(null, a.stops) : '');
      fill('currentQty', a.qty);
      fill('currentMonthly', a.monthly);
      if (a.taxIncluded) {
        c.warnings.push(site + ': 読み取った月額は税込表記です。税抜に直してください。');
      }
      // 提案側は既定値と割引率から下書きを作る（あとから手で直す前提）
      if (isNew || !row.proposalMaker) row.proposalMaker = row.currentMaker;
      if (isNew || !row.proposalQty) row.proposalQty = row.currentQty;
      if (!row.proposalMonthly && row.currentMonthly) {
        row.proposalMonthly = round100(Number(row.currentMonthly) * (1 - Number(d.discountRate || 0)));
      }
    });

    var addedUnits = importUnits(documents);

    // 取り込み前からある空行は片付ける
    c.rows = c.rows.filter(function (r, i) {
      return r.site || r.currentMonthly || c.rows.length === 1;
    });
    if (!c.rows.length) c.rows = [newRow(App.settings)];

    saveCurrent().catch(fail);
    renderAll();
    switchPane(addedUnits ? 'units' : 'rows');
    toast([
      added ? added + ' 件を明細に追加' : '明細を更新',
      addedUnits ? addedUnits + ' 号機を台帳に追加' : ''
    ].filter(Boolean).join('、') + 'しました');
  }

  // 読み取った号機を台帳に入れる。設置場所＋号機（無ければ製造番号）で同じものを見る。
  function importUnits(documents) {
    var c = App.current;
    if (!c.units) c.units = [];
    var added = 0;

    documents.forEach(function (doc) {
      var site = (doc.buildingName || '').trim() || (doc.fileName || '').replace(/\.[^.]+$/, '');
      (doc.units || []).forEach(function (src) {
        var unit = c.units.filter(function (u) {
          if (src.serialNo && u.serialNo) return u.serialNo === src.serialNo;
          return (u.site || '') === site && (u.unitNo || '') === (src.unitNo || '');
        })[0];
        var isNew = !unit;
        if (isNew) {
          unit = newUnit(site);
          c.units.push(unit);
          added++;
        }
        var fill = function (key, value) {
          if (value === undefined || value === null || value === '') return;
          if (isNew || !unit[key]) unit[key] = value;
        };
        fill('unitNo', src.unitNo);
        fill('kind', src.kind === '不明' ? '' : src.kind);
        fill('usage', src.usage);
        fill('maker', src.maker);
        fill('model', src.model);
        fill('serialNo', src.serialNo);
        fill('inspector', src.inspector);
        UNIT_DATE_KEYS.concat(['inspectionDate']).forEach(function (key) {
          fill(key, Lifecycle.normalize(src[key]) || src[key]);
        });
        ['capacityKg', 'capacityPersons', 'ratedSpeed', 'travelM', 'stops'].forEach(function (key) {
          fill(key, src[key]);
        });
        if (!unit.vendor && doc.vendor) unit.vendor = doc.vendor;

        // 履歴と指摘は同じ年月・同じ項目のものを重ねない
        (src.renewals || []).forEach(function (r) {
          var on = Lifecycle.normalize(r.on) || r.on;
          if (!on) return;
          if (unit.renewals.some(function (x) { return x.on === on; })) return;
          unit.renewals.push({ on: on, scope: r.scope || '' });
        });
        (src.findings || []).forEach(function (f) {
          if (!f || !f.item) return;
          if (unit.findings.some(function (x) { return x.item === f.item && x.rank === f.rank; })) return;
          unit.findings.push({ rank: f.rank || '不明', item: f.item, detail: f.detail || '' });
        });
      });
    });
    return added;
  }

  // ---------- ② 昇降機台帳 ----------
  var UNIT_DATE_KEYS = ['confirmationCertificateOn', 'inspectionCertificateOn', 'manufacturedOn', 'installedOn'];

  function newUnit(site) {
    return {
      id: uuid(),
      site: site || '', unitNo: '', kind: 'エレベーター', usage: '',
      maker: '', model: '', serialNo: '',
      confirmationCertificateOn: '', inspectionCertificateOn: '',
      manufacturedOn: '', installedOn: '',
      renewals: [], findings: [],
      capacityKg: '', capacityPersons: '', ratedSpeed: '', travelM: '', stops: '',
      inspectionDate: '', inspector: ''
    };
  }

  function units() {
    var c = App.current;
    if (!c.units) c.units = [];
    return c.units;
  }

  function stateHtml(a) {
    if (!a.elapsed) return '<span class="state none">確認済証交付年月が未入力</span>';
    var e = a.elapsed.years + '年' + a.elapsed.months + 'ヶ月';
    if (a.alert) {
      return '<span class="state bad">' + a.cycleYears + '年経過（' + e + '）</span>';
    }
    if (a.remainingYears <= 3) {
      return '<span class="state soon">あと約' + a.remainingYears + '年で' + a.cycleYears + '年</span>';
    }
    return '<span class="state">経過 ' + e + '</span>';
  }

  function basisHtml(a) {
    if (!a.elapsed) {
      return '<div class="basis"><div class="muted">' +
        '確認済証交付年月（または製造年月）を入れると、経過年数と' +
        Lifecycle.RENEWAL_CYCLE_YEARS + '年の判定が出ます。</div></div>';
    }
    var over = a.remainingMonths < 0;
    return '<div class="basis">' +
      '<div><span class="muted">起点</span> <b>' + esc(Lifecycle.BASIS_LABEL[a.basis]) + '</b>　' +
      esc(Lifecycle.both(a.baseOn)) + '</div>' +
      '<div><span class="muted">経過</span> <b>' + a.elapsed.years + '年' + a.elapsed.months + 'ヶ月</b></div>' +
      '<div><span class="muted">' + a.cycleYears + '年まで</span> <b>' +
      (over ? '超過（' + Math.ceil(-a.remainingMonths / 12) + '年）' : 'あと約' + a.remainingYears + '年') +
      '</b></div>' +
      (a.renewal
        ? '<div><span class="muted">最終リニューアル</span> <b>' + esc(Lifecycle.both(a.renewal.on)) + '</b>' +
          (a.renewal.scope ? '　' + esc(a.renewal.scope) : '') + '</div>'
        : '') +
      '</div>';
  }

  function ufield(i, key, label, type) {
    var v = units()[i][key];
    return '<label class="f">' + esc(label) +
      '<input type="' + (type || 'text') + '" data-u="' + i + '" data-k="' + key + '" value="' +
      esc(v == null ? '' : v) + '"></label>';
  }

  function udate(i, key, label) {
    var v = units()[i][key] || '';
    var hint = Lifecycle.both(v);
    return '<label class="f">' + esc(label) +
      '<input type="text" data-u="' + i + '" data-k="' + key + '" data-date="1" ' +
      'placeholder="2003-04 / 平成15年4月" value="' + esc(v) + '">' +
      '<span class="ymhint' + (hint ? '' : ' empty') + '">' +
      (hint || '西暦でも和暦でも入力できます') + '</span></label>';
  }

  function unitCard(u, i) {
    var a = Lifecycle.assess(u);
    var last = a.renewal;
    var renewals = (u.renewals || []).map(function (r, j) {
      var isLast = last && last === r;
      var wa = Lifecycle.wareki(r.on);
      return '<li class="' + (isLast ? 'last' : '') + '">' +
        '<input class="on" data-ur="' + i + '" data-ri="' + j + '" data-k="on" data-date="1" ' +
        'placeholder="2015-06" value="' + esc(r.on || '') + '">' +
        '<span class="wa">' + esc(wa) + '</span>' +
        '<input class="scope" data-ur="' + i + '" data-ri="' + j + '" data-k="scope" ' +
        'placeholder="実施内容（例: 制御盤更新）" value="' + esc(r.scope || '') + '">' +
        (isLast ? '<span class="wa">最終</span>' : '') +
        '<button class="icon-btn" data-rdel="' + i + '.' + j + '">×</button></li>';
    }).join('');

    var findings = (u.findings || []).map(function (f, j) {
      var cls = f.rank === '要是正' ? 'fix' : f.rank === '要重点点検' ? 'watch' : '';
      return '<li class="' + cls + '">' +
        '<select data-uf="' + i + '" data-fi="' + j + '" data-k="rank">' +
        ['要是正', '要重点点検', '指摘なし', '不明'].map(function (r) {
          return '<option' + (f.rank === r ? ' selected' : '') + '>' + r + '</option>';
        }).join('') + '</select>' +
        '<input data-uf="' + i + '" data-fi="' + j + '" data-k="item" placeholder="項目" value="' + esc(f.item || '') + '">' +
        '<input data-uf="' + i + '" data-fi="' + j + '" data-k="detail" placeholder="内容" value="' + esc(f.detail || '') + '">' +
        '<button class="icon-btn" data-fdel="' + i + '.' + j + '">×</button></li>';
    }).join('');

    var cls = a.alert ? ' is-alert' : (a.elapsed && a.remainingYears <= 3 ? ' is-soon' : '');
    return '<div class="unit' + cls + '">' +
      '<div class="head">' +
      '<div><div class="name">' + esc([u.site, u.unitNo].filter(Boolean).join('　') || '（未入力）') + '</div>' +
      '<div class="sub">' + esc([u.maker, u.model, u.kind, u.usage].filter(Boolean).join(' / ')) + '</div></div>' +
      '<span class="spacer"></span>' + stateHtml(a) +
      '<button class="icon-btn" data-udel="' + i + '">削除</button>' +
      '</div><div class="inner">' +
      basisHtml(a) +
      '<div class="grid c4">' +
      ufield(i, 'site', '設置場所') + ufield(i, 'unitNo', '号機') +
      ufield(i, 'kind', '種別') + ufield(i, 'usage', '用途') +
      ufield(i, 'maker', 'メーカー') + ufield(i, 'model', '型式') +
      ufield(i, 'serialNo', '製造番号') + ufield(i, 'inspector', '検査者') +
      '</div>' +
      '<div class="grid c4" style="margin-top:12px">' +
      udate(i, 'confirmationCertificateOn', '確認済証交付年月') +
      udate(i, 'inspectionCertificateOn', '検査済証交付年月') +
      udate(i, 'manufacturedOn', '製造年月') +
      udate(i, 'inspectionDate', '検査年月日') +
      '</div>' +
      '<div class="grid c4" style="margin-top:12px">' +
      ufield(i, 'capacityKg', '積載量（kg）', 'number') +
      ufield(i, 'capacityPersons', '最大定員（人）', 'number') +
      ufield(i, 'ratedSpeed', '定格速度（m/min）', 'number') +
      ufield(i, 'stops', '停止階数', 'number') +
      '</div>' +
      '<div class="sect">リニューアル履歴</div>' +
      (renewals ? '<ul class="renewals">' + renewals + '</ul>'
        : '<p class="hint" style="margin:0 0 8px">まだありません。実施済みなら追加すると、その年月から数え直します。</p>') +
      '<button class="btn" data-radd="' + i + '">＋ リニューアルを追加</button>' +
      '<div class="sect">指摘事項</div>' +
      (findings ? '<ul class="findings">' + findings + '</ul>'
        : '<p class="hint" style="margin:0 0 8px">指摘はありません。</p>') +
      '<button class="btn" data-fadd="' + i + '">＋ 指摘事項を追加</button>' +
      '</div></div>';
  }

  function updateUnitBadge(count) {
    var dot = $('#unitAlertDot');
    if (!dot) return;
    dot.hidden = !count;
    dot.textContent = count || '';
  }

  function renderUnits() {
    var host = $('#unitsBody');
    if (needCase(host)) { updateUnitBadge(0); return; }
    var list = units();
    var assessed = list.map(function (u) { return Lifecycle.assess(u); });
    var alerts = assessed.filter(function (a) { return a.alert; }).length;
    var soon = assessed.filter(function (a) {
      return !a.alert && a.elapsed && a.remainingYears <= 3;
    }).length;
    var issues = list.reduce(function (n, u) {
      return n + (u.findings || []).filter(function (f) {
        return f.rank === '要是正' || f.rank === '要重点点検';
      }).length;
    }, 0);
    updateUnitBadge(alerts);

    host.innerHTML =
      '<div class="summary">' +
      '<div class="stat"><div class="n">' + list.length + '</div><div class="k">登録された号機</div></div>' +
      '<div class="stat' + (alerts ? ' alert' : '') + '"><div class="n">' + alerts + '</div>' +
      '<div class="k">' + Lifecycle.RENEWAL_CYCLE_YEARS + '年経過（要リニューアル検討）</div></div>' +
      '<div class="stat"><div class="n">' + soon + '</div><div class="k">3年以内に' +
      Lifecycle.RENEWAL_CYCLE_YEARS + '年</div></div>' +
      '<div class="stat"><div class="n">' + issues + '</div><div class="k">要是正・要重点点検</div></div>' +
      '</div>' +
      (list.length
        ? list.map(unitCard).join('')
        : '<div class="card"><p class="hint" style="margin:0">' +
          '「① 書類読み取り」で定期検査報告書を読み取ると、号機がここに並びます。手で追加もできます。</p></div>') +
      '<button id="addUnitBtn" class="btn">＋ 号機を追加</button>';

    bindUnits(host);
  }

  function bindUnits(host) {
    var c = App.current;

    host.addEventListener('input', function (e) {
      var el = e.target;
      if (el.dataset.u !== undefined) {
        var u = units()[Number(el.dataset.u)];
        u[el.dataset.k] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
        if (el.dataset.date) updateDateHint(el);
        touch();
      } else if (el.dataset.ur !== undefined) {
        var r = units()[Number(el.dataset.ur)].renewals[Number(el.dataset.ri)];
        r[el.dataset.k] = el.value;
        touch();
      } else if (el.dataset.uf !== undefined) {
        var f = units()[Number(el.dataset.uf)].findings[Number(el.dataset.fi)];
        f[el.dataset.k] = el.value;
        touch();
      }
    });

    // 入力欄を離れたところで「平成15年4月」→「2003-04」に直し、判定も引き直す
    host.addEventListener('change', function (e) {
      var el = e.target;
      if (!el.dataset.date && el.dataset.uf === undefined) return;
      if (el.dataset.date) {
        var normalized = Lifecycle.normalize(el.value);
        if (normalized) {
          if (el.dataset.u !== undefined) units()[Number(el.dataset.u)][el.dataset.k] = normalized;
          if (el.dataset.ur !== undefined) {
            units()[Number(el.dataset.ur)].renewals[Number(el.dataset.ri)][el.dataset.k] = normalized;
          }
        }
      }
      touch();
      renderUnits();
    });

    $$('[data-udel]', host).forEach(function (b) {
      b.onclick = function () {
        if (!confirm('この号機を台帳から削除します。よろしいですか？')) return;
        units().splice(Number(b.dataset.udel), 1);
        touch(); renderUnits();
      };
    });
    $$('[data-radd]', host).forEach(function (b) {
      b.onclick = function () {
        units()[Number(b.dataset.radd)].renewals.push({ on: '', scope: '' });
        touch(); renderUnits();
      };
    });
    $$('[data-rdel]', host).forEach(function (b) {
      b.onclick = function () {
        var p = b.dataset.rdel.split('.');
        units()[Number(p[0])].renewals.splice(Number(p[1]), 1);
        touch(); renderUnits();
      };
    });
    $$('[data-fadd]', host).forEach(function (b) {
      b.onclick = function () {
        units()[Number(b.dataset.fadd)].findings.push({ rank: '要是正', item: '', detail: '' });
        touch(); renderUnits();
      };
    });
    $$('[data-fdel]', host).forEach(function (b) {
      b.onclick = function () {
        var p = b.dataset.fdel.split('.');
        units()[Number(p[0])].findings.splice(Number(p[1]), 1);
        touch(); renderUnits();
      };
    });
    if ($('#addUnitBtn')) {
      $('#addUnitBtn').onclick = function () {
        var site = (c.rows && c.rows[0] && c.rows[0].site) || '';
        units().push(newUnit(site));
        touch(); renderUnits();
      };
    }
  }

  function updateDateHint(input) {
    var hint = input.parentNode.querySelector('.ymhint');
    if (!hint) return;
    var both = Lifecycle.both(input.value);
    hint.textContent = both || '西暦でも和暦でも入力できます';
    hint.classList.toggle('empty', !both);
  }

  // ---------- ③ 明細 ----------
  var CUR_COLS = [
    { k: 'site', label: '設置場所', w: 150 },
    { k: 'currentMaker', label: 'メーカー', w: 84 },
    { k: 'currentQty', label: '台数', w: 46, num: true },
    { k: 'currentVendor', label: '保守ベンダー', w: 160 },
    { k: 'currentFrequency', label: '点検頻度', w: 96, multi: true },
    { k: 'currentSpec', label: '仕様', w: 116, multi: true },
    { k: 'stops', label: '停止階数', w: 56, num: true },
    { k: 'currentPlan', label: '契約内容', w: 82 },
    { k: 'currentMonthly', label: '月額保守料金', w: 100, num: true }
  ];
  var PRO_COLS = [
    { k: 'proposalMaker', label: 'メーカー', w: 84 },
    { k: 'proposalQty', label: '台数', w: 46, num: true },
    { k: 'proposalVendor', label: '提案ベンダー', w: 170 },
    { k: 'proposalFrequency', label: '点検頻度', w: 96, multi: true },
    { k: 'proposalSpec', label: '仕様', w: 116, multi: true },
    { k: 'proposalPlan', label: '契約内容', w: 82 },
    { k: 'proposalMonthly', label: '月額保守料金', w: 100, num: true }
  ];

  function totals(c) {
    var cur = 0, pro = 0;
    (c.rows || []).forEach(function (r) {
      cur += Number(r.currentMonthly) || 0;
      pro += Number(r.proposalMonthly) || 0;
    });
    return { current: cur, proposal: pro, diff: pro - cur, rate: cur ? (pro - cur) / cur : 0 };
  }

  function cellHtml(row, i, col) {
    var v = row[col.k] == null ? '' : row[col.k];
    var attrs = 'data-i="' + i + '" data-k="' + col.k + '"';
    if (col.multi) {
      return '<td><textarea rows="2" ' + attrs + '>' + esc(v) + '</textarea></td>';
    }
    return '<td' + (col.num ? ' class="num"' : '') + '>' +
      '<input type="' + (col.num ? 'number' : 'text') + '" ' + attrs + ' value="' + esc(v) + '"></td>';
  }

  function renderRows() {
    var host = $('#rowsBody');
    if (needCase(host)) return;
    var c = App.current;
    var d = App.settings.defaults;
    var t = totals(c);

    var cols = '<colgroup><col style="width:34px">' +
      CUR_COLS.map(function (col) { return '<col style="width:' + col.w + 'px">'; }).join('') +
      '<col class="sep">' +
      PRO_COLS.map(function (col) { return '<col style="width:' + col.w + 'px">'; }).join('') +
      '<col style="width:70px"></colgroup>';

    var head =
      '<thead><tr>' +
      '<th rowspan="2"></th>' +
      '<th class="grp" colspan="' + CUR_COLS.length + '">現行</th>' +
      '<th class="sep" rowspan="2"></th>' +
      '<th class="grp prop" colspan="' + PRO_COLS.length + '">提案</th>' +
      '<th rowspan="2"></th>' +
      '</tr><tr>' +
      CUR_COLS.map(function (col) { return '<th>' + esc(col.label) + '</th>'; }).join('') +
      PRO_COLS.map(function (col) { return '<th>' + esc(col.label) + '</th>'; }).join('') +
      '</tr></thead>';

    var body = '<tbody>' + c.rows.map(function (r, i) {
      return '<tr>' +
        '<td class="ops">' + (i + 1) + '</td>' +
        CUR_COLS.map(function (col) { return cellHtml(r, i, col); }).join('') +
        '<td class="sep"></td>' +
        PRO_COLS.map(function (col) { return cellHtml(r, i, col); }).join('') +
        '<td class="ops">' +
        '<button data-up="' + i + '" title="上へ">▲</button>' +
        '<button data-down="' + i + '" title="下へ">▼</button>' +
        '<button data-del="' + i + '" title="削除">×</button>' +
        '</td></tr>';
    }).join('') + '</tbody>';

    var foot =
      '<tfoot><tr>' +
      '<th></th><th colspan="' + (CUR_COLS.length - 1) + '" style="text-align:right;padding-right:8px">現行 合計</th>' +
      '<th style="text-align:right;padding-right:8px">¥' + money(t.current) + '</th>' +
      '<th class="sep"></th>' +
      '<th colspan="' + (PRO_COLS.length - 1) + '" style="text-align:right;padding-right:8px">提案 合計</th>' +
      '<th style="text-align:right;padding-right:8px">¥' + money(t.proposal) + '</th>' +
      '<th></th></tr></tfoot>';

    host.innerHTML =
      '<div class="card">' +
      '<h2>提案側を一括で埋める</h2>' +
      '<div class="grid c4">' +
      '<label class="f">提案ベンダー<input id="bkVendor" value="' + esc(d.proposalVendor) + '"></label>' +
      '<label class="f">点検頻度<textarea id="bkFreq" rows="2">' + esc(d.proposalFrequency) + '</textarea></label>' +
      '<label class="f">仕様<textarea id="bkSpec" rows="2">' + esc(d.proposalSpec) + '</textarea></label>' +
      '<label class="f">契約内容<input id="bkPlan" value="' + esc(d.proposalPlan) + '"></label>' +
      '</div>' +
      '<div class="grid c4" style="margin-top:12px; align-items:end">' +
      '<label class="f">現行からの削減率（%）<input id="bkDiscount" type="number" step="1" value="' +
      Math.round(Number(d.discountRate || 0) * 100) + '"></label>' +
      '<div><button id="bkApply" class="btn primary">提案側に反映</button></div>' +
      '<div><button id="bkCopy" class="btn">メーカー・台数を現行からコピー</button></div>' +
      '<div><button id="bkPrice" class="btn">提案金額だけ削減率から再計算</button></div>' +
      '</div>' +
      '<p class="hint">反映は空欄だけでなく上書きします。個別に変えた行は反映後に直してください。</p>' +
      '</div>' +
      '<div class="card">' +
      '<h2>明細</h2>' +
      '<div style="overflow:auto"><table class="rows">' + cols + head + body + foot + '</table></div>' +
      '<div style="margin-top:12px; display:flex; gap:10px; align-items:center">' +
      '<button id="addRowBtn" class="btn">＋ 行を追加</button>' +
      '<span class="hint" id="diffHint">' + diffText(t) + '</span>' +
      '</div></div>' +
      ((c.warnings || []).length
        ? '<div class="card"><h2>確認が必要な点</h2><div class="warn">' +
          c.warnings.map(esc).join('<br>') +
          '</div><button id="clearWarn" class="btn ghost" style="margin-top:10px">確認済みにする</button></div>'
        : '');

    var table = $('.rows', host);
    table.addEventListener('input', function (e) {
      var el = e.target;
      if (el.dataset.i === undefined) return;
      var row = c.rows[Number(el.dataset.i)];
      var key = el.dataset.k;
      row[key] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      if (key === 'currentMonthly' || key === 'proposalMonthly') updateFooter(c);
      touch();
    });
    $$('[data-del]', table).forEach(function (b) {
      b.onclick = function () {
        c.rows.splice(Number(b.dataset.del), 1);
        if (!c.rows.length) c.rows.push(newRow(App.settings));
        touch(); renderRows(); renderPreview();
      };
    });
    $$('[data-up]', table).forEach(function (b) {
      b.onclick = function () { moveRow(Number(b.dataset.up), -1); };
    });
    $$('[data-down]', table).forEach(function (b) {
      b.onclick = function () { moveRow(Number(b.dataset.down), 1); };
    });
    $('#addRowBtn').onclick = function () {
      c.rows.push(newRow(App.settings));
      touch(); renderRows(); renderPreview();
    };
    $('#bkApply').onclick = function () { bulkApply(true); };
    $('#bkCopy').onclick = function () {
      c.rows.forEach(function (r) {
        r.proposalMaker = r.currentMaker;
        r.proposalQty = r.currentQty;
      });
      touch(); renderRows(); renderPreview();
    };
    $('#bkPrice').onclick = function () { bulkApply(false); };
    if ($('#clearWarn')) {
      $('#clearWarn').onclick = function () {
        c.warnings = [];
        touch(); renderRows();
      };
    }
  }

  function diffText(t) {
    return '削減額 ' + money(-t.diff) + ' 円／月　（' +
      (t.current ? (-t.rate * 100).toFixed(2) : '0.00') + '%）';
  }

  function updateFooter(c) {
    var t = totals(c);
    var cells = $$('#rowsBody tfoot th');
    if (cells.length) {
      cells[2].textContent = '¥' + money(t.current);
      cells[5].textContent = '¥' + money(t.proposal);
    }
    var hint = $('#diffHint');
    if (hint) hint.textContent = diffText(t);
    renderPreview();
  }

  function moveRow(i, dir) {
    var rows = App.current.rows;
    var j = i + dir;
    if (j < 0 || j >= rows.length) return;
    var tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
    touch(); renderRows(); renderPreview();
  }

  function bulkApply(applyText) {
    var c = App.current;
    var discount = Number($('#bkDiscount').value || 0) / 100;
    var vendor = $('#bkVendor').value;
    var freq = $('#bkFreq').value;
    var spec = $('#bkSpec').value;
    var plan = $('#bkPlan').value;
    c.rows.forEach(function (r) {
      if (applyText) {
        r.proposalVendor = vendor;
        r.proposalFrequency = freq;
        r.proposalSpec = spec;
        r.proposalPlan = plan;
        if (!r.proposalMaker) r.proposalMaker = r.currentMaker;
        if (!r.proposalQty) r.proposalQty = r.currentQty;
      }
      if (r.currentMonthly) {
        r.proposalMonthly = round100(Number(r.currentMonthly) * (1 - discount));
      }
    });
    App.settings.defaults.discountRate = discount;
    if (applyText) {
      App.settings.defaults.proposalVendor = vendor;
      App.settings.defaults.proposalFrequency = freq;
      App.settings.defaults.proposalSpec = spec;
      App.settings.defaults.proposalPlan = plan;
    }
    Store.writeJson('settings.json', App.settings).catch(fail);
    touch(); renderRows(); renderPreview();
  }

  // ---------- ④ 表紙・備考 ----------
  function renderCover() {
    var host = $('#coverBody');
    if (needCase(host)) return;
    var c = App.current;
    var rates = c.profitRates || [0.2, 0.1, 0.05];

    host.innerHTML =
      '<div class="card"><h2>宛先とタイトル</h2><div class="grid c3">' +
      field('お客様名', 'customerName', c.customerName) +
      field('敬称', 'customerHonorific', c.customerHonorific) +
      field('作成日', 'caseDate', c.caseDate, 'date') +
      field('タイトル', 'title', c.title) +
      field('シート名', 'sheetName', c.sheetName) +
      field('見出し帯', 'sectionTitle', c.sectionTitle) +
      '</div></div>' +

      '<div class="card"><h2>作成者（比較表の右上に入ります）</h2><div class="grid c2">' +
      field('1行目（会社名）', 'issuer.line1', c.issuer.line1) +
      field('2行目（住所）', 'issuer.line2', c.issuer.line2) +
      field('3行目（電話・FAX）', 'issuer.line3', c.issuer.line3) +
      field('4行目（担当）', 'issuer.line4', c.issuer.line4) +
      '</div><p class="hint">既定値は設定画面で変えられます。</p></div>' +

      '<div class="card"><h2>合計の条件</h2><div class="grid c4">' +
      field('累計年数', 'years', c.years, 'number') +
      field('利益率①', 'profitRates.0', Math.round(rates[0] * 100), 'number', '%') +
      field('利益率②', 'profitRates.1', Math.round(rates[1] * 100), 'number', '%') +
      field('利益率③', 'profitRates.2', Math.round(rates[2] * 100), 'number', '%') +
      '</div><p class="hint">利益率は「年間売上高に換算したコスト削減効果」の欄に使います。</p></div>' +

      '<div class="card"><h2>備考</h2>' +
      '<label class="f"><textarea data-f="remarks" rows="9">' + esc(c.remarks) + '</textarea></label>' +
      '</div>';

    host.addEventListener('input', function (e) {
      var path = e.target.dataset.f;
      if (!path) return;
      var value = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
      if (/^profitRates\./.test(path)) {
        var idx = Number(path.split('.')[1]);
        c.profitRates[idx] = Number(e.target.value) / 100;
      } else if (/^issuer\./.test(path)) {
        c.issuer[path.split('.')[1]] = value;
      } else {
        c[path] = value;
      }
      touch();
      renderPreview();
      if (path === 'customerName' || path === 'caseDate') renderCaseList();
    });
  }

  function field(label, path, value, type, suffix) {
    return '<label class="f">' + esc(label) + (suffix ? '（' + suffix + '）' : '') +
      '<input type="' + (type || 'text') + '" data-f="' + path + '" value="' + esc(value == null ? '' : value) + '"></label>';
  }

  // ---------- ⑤ 比較表（画面プレビュー＝印刷レイアウト） ----------
  function jpDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    return m[1] + '/' + Number(m[2]) + '/' + Number(m[3]);
  }

  function renderPreview() {
    var host = $('#previewBody');
    if (needCase(host)) return;
    var c = App.current;
    host.innerHTML =
      '<div class="no-print" style="padding:14px 18px; display:flex; gap:10px; align-items:center; background:#fff; border-bottom:1px solid var(--line)">' +
      '<button id="exportBtn" class="btn primary">Excel を書き出す</button>' +
      '<button id="printBtn" class="btn">印刷 / PDF</button>' +
      '<span class="hint" id="tplHint"></span>' +
      '</div>' + buildSheet(c);

    fitSheet();
    $('#printBtn').onclick = function () { window.print(); };
    $('#exportBtn').onclick = function () { exportExcel().catch(fail); };
    $('#tplHint').textContent = App.templateBytes
      ? 'ひな形: data/template.xlsx'
      : (location.protocol === 'file:'
        ? 'ひな形が未登録です。書き出し時に template/ev-hikaku-template.xlsx を選んでください。'
        : 'ひな形は書き出し時に自動で取り込まれます。');
  }

  // プレビューは実寸 1420px。ペインに収まるよう縮小して全体を見せる。
  function fitSheet() {
    var wrap = $('.sheet-wrap');
    var sheet = $('.sheet');
    if (!wrap || !sheet) return;
    // ペインが非表示のうちは幅が取れないので、そのときは触らない
    if (!wrap.clientWidth) return;
    var scale = Math.min(1, (wrap.clientWidth - 44) / 1420);
    sheet.style.zoom = scale > 0.2 ? scale : 1;
  }

  function buildSheet(c) {
    var t = totals(c);
    var years = Number(c.years) || 10;
    var rates = c.profitRates || [0.2, 0.1, 0.05];
    var rows = c.rows || [];

    var left =
      '<table class="ev"><colgroup>' +
      '<col style="width:26px"><col style="width:19%"><col style="width:11%"><col style="width:7%">' +
      '<col style="width:19%"><col style="width:11%"><col style="width:13%"><col style="width:8%">' +
      '<col style="width:10%"><col style="width:15%"></colgroup>' +
      '<thead><tr><th></th><th class="site">設置場所</th><th>メーカー</th><th>台数</th>' +
      '<th>保守ベンダー</th><th>点検頻度</th><th>仕様</th><th>停止階数</th>' +
      '<th>契約内容</th><th>月額保守料金</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr><td class="no">' + (i + 1) + '</td>' +
          '<td style="font-weight:700">' + esc(r.site) + '</td>' +
          '<td>' + esc(r.currentMaker) + '</td>' +
          '<td>' + esc(r.currentQty) + '</td>' +
          '<td>' + esc(r.currentVendor) + '</td>' +
          '<td>' + esc(r.currentFrequency) + '</td>' +
          '<td>' + esc(r.currentSpec) + '</td>' +
          '<td>' + esc(r.stops) + '</td>' +
          '<td>' + esc(r.currentPlan) + '</td>' +
          '<td class="money">' + money(r.currentMonthly) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td colspan="9">販売価格　合計</td>' +
      '<td class="money">' + money(t.current) + '</td></tr></tfoot></table>';

    var right =
      '<table class="ev"><colgroup>' +
      '<col style="width:12%"><col style="width:7%"><col style="width:24%"><col style="width:12%">' +
      '<col style="width:15%"><col style="width:11%"><col style="width:17%"></colgroup>' +
      '<thead><tr><th>メーカー</th><th>台数</th><th>提案ベンダー</th><th>点検頻度</th>' +
      '<th>仕様</th><th>契約内容</th><th>月額保守料金</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var changed = r.emphasizePlan === true ||
          (r.emphasizePlan !== false && !!r.proposalPlan &&
            String(r.proposalPlan) !== String(r.currentPlan || ''));
        return '<tr>' +
          '<td>' + esc(r.proposalMaker) + '</td>' +
          '<td>' + esc(r.proposalQty) + '</td>' +
          '<td>' + esc(r.proposalVendor) + '</td>' +
          '<td class="red">' + esc(r.proposalFrequency) + '</td>' +
          '<td>' + esc(r.proposalSpec) + '</td>' +
          '<td' + (changed ? ' class="red"' : '') + '>' + esc(r.proposalPlan) + '</td>' +
          '<td class="money">' + money(r.proposalMonthly) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td colspan="6">販売価格　合計</td>' +
      '<td class="money">' + money(t.proposal) + '</td></tr></tfoot></table>';

    function sumBlock(monthly) {
      return '<table class="sum right">' +
        '<tr><td class="cap" colspan="1">-  合 計  -</td></tr>' +
        '<tr><td class="lbl">合計金額　（単月）</td></tr>' +
        '<tr><td class="val">' + money(monthly) + '</td></tr>' +
        '<tr><td class="lbl">合計金額　（年間）</td></tr>' +
        '<tr><td class="val">' + money(monthly * 12) + '</td></tr>' +
        '<tr><td class="lbl">合計金額　（' + years + '年間）</td></tr>' +
        '<tr><td class="val">' + money(monthly * 12 * years) + '</td></tr>' +
        '</table>';
    }

    var cut =
      '<table class="sum right cut">' +
      '<tr><td class="cap">-  削 減 料 金  -</td></tr>' +
      '<tr><td class="lbl">合計合算削減金額　（単月）</td></tr>' +
      '<tr><td class="val">' + money(t.diff) + '</td></tr>' +
      '<tr><td class="lbl">合計合算削減金額　（年間）</td></tr>' +
      '<tr><td class="val">' + money(t.diff * 12) + '</td></tr>' +
      '<tr><td class="lbl">合計合算削減金額　（' + years + '年間）</td></tr>' +
      '<tr><td class="val">' + money(t.diff * 12 * years) + '</td></tr>' +
      '<tr><td class="lbl">削減率</td></tr>' +
      '<tr><td class="pct">' + (t.current ? (t.rate * 100).toFixed(2) : '0.00') + '%</td></tr>' +
      '</table>';

    var annualCut = -t.diff * 12;
    var roi =
      '<div>' +
      '<table class="roi">' +
      '<tr><td class="cap" colspan="4">年間売上高に換算したコスト削減効果</td></tr>' +
      '<tr><td class="cap"></td><td class="cap" colspan="3">利益率</td></tr>' +
      '<tr><td class="cap" rowspan="2">年間<br>売上高</td>' +
      rates.map(function (r, i) {
        return '<td class="r' + i + '">' + Math.round(r * 100) + '%</td>';
      }).join('') + '</tr><tr>' +
      rates.map(function (r) {
        return '<td class="amt">' + money(r ? Math.round(annualCut / r) : 0) + '</td>';
      }).join('') + '</tr></table>' +
      '<div class="roi-note">上記程度の「売上高が増加した」ことと<br>同等の効果が得られます</div>' +
      '</div>';

    return '<div class="sheet-wrap"><div class="sheet">' +
      '<div class="s-date">' + esc(jpDate(c.caseDate)) + '</div>' +
      '<div class="s-top">' +
      '<div class="s-to">' + esc(c.customerName) + '　' + esc(c.customerHonorific) + '</div>' +
      '<div class="s-title">' + esc(c.title) + '</div>' +
      '<div class="s-issuer"><img src="' + EV_LOGO_DATA_URI + '" alt="">' +
      [c.issuer.line1, c.issuer.line2, c.issuer.line3, c.issuer.line4]
        .map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') +
      '</div></div>' +
      '<div class="s-band">' + esc(c.sectionTitle) + '</div>' +
      '<div class="s-cols">' + left + '<div class="s-arrow">➡</div>' + right + '</div>' +
      '<div class="s-cols">' + sumBlock(t.current) + '<div></div>' + sumBlock(t.proposal) + '</div>' +
      '<div class="s-lower"><div></div>' + roi + cut + '</div>' +
      '<div class="remarks"><div class="remarks-cap">【備考】</div>' + esc(c.remarks) + '</div>' +
      '</div></div>';
  }

  // ---------- Excel 書き出し ----------
  // start.cmd（ローカルサーバー）経由で開いているときは同梱のひな形をそのまま使う。
  // file:// で直接開いた場合は取得できないので、そのときだけ選んでもらう。
  async function fetchBundledTemplate() {
    if (location.protocol === 'file:') return null;
    try {
      var res = await fetch('template/ev-hikaku-template.xlsx', { cache: 'no-store' });
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  async function adoptBundledTemplate() {
    var bytes = await fetchBundledTemplate();
    if (!bytes) return null;
    await Store.write('template.xlsx', bytes).catch(function () { });
    return bytes;
  }

  async function ensureTemplate() {
    if (App.templateBytes) return App.templateBytes;
    if (await Store.exists('template.xlsx')) {
      App.templateBytes = await Store.readBytes('template.xlsx');
      return App.templateBytes;
    }
    App.templateBytes = await adoptBundledTemplate();
    if (App.templateBytes) return App.templateBytes;

    var picked = await new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx';
      input.onchange = function () { resolve(input.files[0] || null); };
      input.click();
    });
    if (!picked) throw new Error('ひな形 (ev-hikaku-template.xlsx) が選ばれませんでした');
    var bytes = new Uint8Array(await picked.arrayBuffer());
    await Store.write('template.xlsx', bytes);
    App.templateBytes = bytes;
    toast('ひな形を data/template.xlsx に保存しました');
    return bytes;
  }

  function safeName(s) {
    return String(s || '').replace(/[\\\/:*?"<>|]/g, '_').trim();
  }

  async function exportExcel() {
    var c = App.current;
    var template = await ensureTemplate();
    var model = {
      sheetName: c.sheetName,
      title: c.title,
      sectionTitle: c.sectionTitle,
      date: c.caseDate,
      customer: (c.customerName || '') + '　' + (c.customerHonorific || ''),
      issuer: c.issuer,
      years: Number(c.years) || 10,
      profitRates: c.profitRates,
      remarks: c.remarks,
      rows: c.rows,
      emphasizePlanChange: true
    };
    var bytes = XlsxFill.fill(template, model);
    var fileName = '【' + safeName(c.title) + '】' + safeName(c.customerName || '無題') + '.xlsx';

    await Store.write('exports/' + fileName, bytes).catch(function () { });
    var result = await Downloader.save(
      fileName, bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    toast(result && result.message ? result.message : 'Excel を書き出しました');
  }

  // ---------- 設定 ----------
  function openSettings() {
    if (!Store.connected()) return toast('先にデータフォルダを接続してください', true);
    var s = App.settings;
    var d = s.defaults;
    var dlg = document.createElement('dialog');
    dlg.style.cssText = 'border:0;border-radius:10px;padding:0;width:min(760px,92vw)';
    dlg.innerHTML =
      '<form method="dialog" style="padding:20px">' +
      '<h2 style="margin:0 0 16px;font-size:16px">設定</h2>' +
      '<div class="card"><h2>作成者の既定値</h2><div class="grid c2">' +
      ['line1', 'line2', 'line3', 'line4'].map(function (k, i) {
        return '<label class="f">' + ['会社名', '住所', '電話・FAX', '担当'][i] +
          '<input data-s="issuer.' + k + '" value="' + esc(s.issuer[k]) + '"></label>';
      }).join('') +
      '</div></div>' +
      '<div class="card"><h2>比較表の既定値</h2><div class="grid c2">' +
      '<label class="f">タイトル<input data-s="defaults.title" value="' + esc(d.title) + '"></label>' +
      '<label class="f">シート名<input data-s="defaults.sheetName" value="' + esc(d.sheetName) + '"></label>' +
      '<label class="f">提案ベンダー<input data-s="defaults.proposalVendor" value="' + esc(d.proposalVendor) + '"></label>' +
      '<label class="f">契約内容<input data-s="defaults.proposalPlan" value="' + esc(d.proposalPlan) + '"></label>' +
      '<label class="f">点検頻度<textarea data-s="defaults.proposalFrequency" rows="2">' + esc(d.proposalFrequency) + '</textarea></label>' +
      '<label class="f">仕様<textarea data-s="defaults.proposalSpec" rows="2">' + esc(d.proposalSpec) + '</textarea></label>' +
      '<label class="f">累計年数<input type="number" data-s="defaults.years" value="' + esc(d.years) + '"></label>' +
      '<label class="f">既定の削減率（%）<input type="number" data-s="defaults.discountRatePct" value="' +
      Math.round(Number(d.discountRate || 0) * 100) + '"></label>' +
      '</div>' +
      '<label class="f" style="margin-top:12px">備考の既定文<textarea data-s="defaults.remarks" rows="6">' + esc(d.remarks) + '</textarea></label>' +
      '</div>' +
      '<div class="card"><h2>Claude</h2><div class="grid c2">' +
      '<label class="f">モデル<input data-s="ai.model" value="' + esc(s.ai.model) + '"></label>' +
      '<label class="f">API キー（data/api-key.txt）<input id="apiKeyInput" type="password" value="' + esc(App.apiKey) + '"></label>' +
      '</div></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end">' +
      '<button value="cancel" class="btn">閉じる</button>' +
      '<button id="saveSettings" value="ok" class="btn primary">保存</button>' +
      '</div></form>';
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.addEventListener('close', async function () {
      if (dlg.returnValue === 'ok') {
        $$('[data-s]', dlg).forEach(function (el) {
          var parts = el.dataset.s.split('.');
          var key = parts[1];
          var value = el.type === 'number' ? Number(el.value) : el.value;
          if (key === 'discountRatePct') { s.defaults.discountRate = Number(el.value) / 100; return; }
          s[parts[0]][key] = value;
        });
        await Store.writeJson('settings.json', s);
        var key = $('#apiKeyInput', dlg).value.trim();
        if (key !== App.apiKey) {
          await Store.write('api-key.txt', key);
          App.apiKey = key;
        }
        toast('設定を保存しました');
        renderAll();
      }
      dlg.remove();
    });
  }

  // ---------- 起動 ----------
  function switchPane(name) {
    $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.pane === name); });
    $$('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + name); });
    if (name === 'preview') fitSheet();
  }

  function init() {
    $('#brandLogo').src = EV_LOGO_DATA_URI;
    $$('.tabs button').forEach(function (b) {
      b.onclick = function () { switchPane(b.dataset.pane); };
    });
    $('#connectBtn').onclick = function () {
      connect(true).catch(fail);
    };
    $('#settingsBtn').onclick = openSettings;
    $('#caseSearch').oninput = renderCaseList;
    $('#newCaseBtn').onclick = async function () {
      if (!Store.connected()) return toast('先にデータフォルダを接続してください', true);
      App.current = newCase();
      await saveCurrent();
      renderAll();
      switchPane('cover');
    };
    window.addEventListener('resize', fitSheet);
    window.addEventListener('beforeunload', function (e) {
      if (!App.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    if (!Store.supported()) {
      App.settings = mergeDefaults(null);
      renderAll();
      toast('このブラウザはフォルダ保存に対応していません。Chrome か Edge で開いてください。', true);
      return;
    }
    App.settings = mergeDefaults(null);
    Store.restore().then(function (dir) {
      if (dir) return afterConnect();
      renderChip();
      renderAll();
    }).catch(function (e) {
      renderChip();
      renderAll();
      console.warn(e);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
