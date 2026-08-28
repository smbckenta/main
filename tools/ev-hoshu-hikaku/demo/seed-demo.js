/*
 * デモの初期状態を用意する。
 * 実案件と同じ8件を入れた状態から始めて、すぐ比較表を見られるようにする。
 */
(function () {
  'use strict';

  var F2 = '有人点検\n1回/2ヶ月';
  var F3 = '有人点検\n1回/3ヶ月';
  var SPEC = '遠隔監視装置付き';
  var PSPEC = '遠隔監視装置付き\nQRサポート付き';
  var ELE = 'エレベーターコミュニケーションズ㈱';

  function row(site, maker, qty, vendor, freq, stops, plan, cur, pfreq, pro) {
    return {
      id: 'demo-' + site,
      site: site, currentMaker: maker, currentQty: qty, currentVendor: vendor,
      currentFrequency: freq, currentSpec: SPEC, stops: stops,
      currentPlan: plan, currentMonthly: cur,
      proposalMaker: maker, proposalQty: qty, proposalVendor: ELE,
      proposalFrequency: pfreq, proposalSpec: PSPEC, proposalPlan: 'FM契約',
      proposalMonthly: pro, emphasizePlan: null
    };
  }

  var SAMPLE_CASE = {
    id: 'demo-case',
    title: 'EV保守 価格比較表',
    sheetName: 'エレコミ',
    sectionTitle: '-  エ レ ベ ー タ ー 料 金 詳 細 内 訳  - ',
    customerName: '株式会社リー・グローブ',
    customerHonorific: '御中',
    caseDate: '2026-05-20',
    years: 10,
    profitRates: [0.2, 0.1, 0.05],
    issuer: {
      line1: 'ＥＶパートナーズ株式会社',
      line2: '〒830-0044　福岡県久留米市本町2-23　栗原ビルディング4F',
      line3: 'TEL：0942-64-9035　　FAX：0942-64-9036',
      line4: '担当:小坂'
    },
    remarks: [
      '・エレベーターコミュニケーションズ㈱様はエレベーターの独立系保守ベンダーにて業界3位の規模となり、札幌証券取引所および福岡証券取引所の本則市場に上場しております。',
      '・上記金額はすべて年1回の法定検査も含まれた金額となります。',
      '・上記ランニングコストに加え、約25年周期のリニューアル工事費用につきましては、メーカー系保守ベンダー対比で独立系保守ベンダーは30％-40％程度削減できる見込みです。',
      '※原則、現在の契約内容と同条件にて価格の比較をしております。点検条件、その他オプション等につきましてはお見積をご覧くださいませ。'
    ].join('\n'),
    rows: [
      row('ジャンボ岩国店', '三菱', 2, 'マーキュリーアシェンソーレ㈱', '不明', 5, 'POG契約', 36000, F3, 54000),
      row('ジャンボ防府店', 'フジテック', 2, 'マーキュリーアシェンソーレ㈱', F2, 5, 'FM契約', 66000, F2, 56000),
      row('ジャンボ井原店', '三菱', 1, 'エス・イー・シーエレベーター㈱', F2, 4, 'FM契約', 30000, F2, 27000),
      row('ジャンボ水島店', '日立', 2, 'エス・イー・シーエレベーター㈱', F2, 4, 'FM契約', 68000, F2, 54000),
      row('サンエイ倉敷本店', '三菱', 1, 'エス・イー・シーエレベーター㈱', F2, 4, 'FM契約', 30000, F2, 27000),
      row('ジャンボ備前店', '東芝', 1, 'エス・イー・シーエレベーター㈱', F2, 5, 'FM契約', 34000, F2, 27000),
      row('アミスタ大供', 'オーチス', 1, '日本オーチス・エレベータ㈱', '不明', 10, 'FM契約', 60000, F3, 32000),
      row('アミスタ東島田', 'オーチス', 1, '日本オーチス・エレベータ㈱', '不明', 10, 'FM契約', 55000, F3, 32000)
    ],
    ingest: [], files: [], warnings: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  };

  // store-demo.js の restore() から、一覧を読む前に呼ばれる
  window.EV_DEMO_SEED = async function () {
    if (!(await Store.exists('cases/demo-case.json'))) {
      await Store.writeJson('cases/demo-case.json', SAMPLE_CASE);
    }
  };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    // デモではフォルダ選択が意味を持たないので隠す
    var connect = document.querySelector('#connectBtn');
    if (connect) connect.style.display = 'none';

    // app.js が一覧を描いたら、その案件を開く
    var tries = 0;
    var timer = setInterval(function () {
      var first = document.querySelector('#caseList li');
      if (first) { first.click(); clearInterval(timer); return; }
      if (++tries > 40) clearInterval(timer);
    }, 120);

    var reset = document.querySelector('#demoReset');
    if (reset) {
      reset.onclick = async function () {
        for (var name of await Store.listDir('cases')) await Store.remove('cases/' + name);
        await Store.remove('settings.json');
        location.reload();
      };
    }
  });
})();
