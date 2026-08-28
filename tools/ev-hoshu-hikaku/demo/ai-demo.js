/*
 * デモ版の書類読み取り。
 * 本物は Claude API に PDF を送って読ませるが、Artifact からは外部 API を呼べないため、
 * あらかじめ用意した読み取り結果を返して、確認 → 取り込みの流れだけを見せる。
 */
(function (global) {
  'use strict';

  var SAMPLE = [
    {
      fileName: '定期検査報告書_サンエイ玉野店.pdf',
      docType: '定期検査報告書',
      confidence: 0.93,
      buildingName: 'サンエイ玉野店',
      buildingAddress: '岡山県玉野市築港1丁目',
      owner: '株式会社リー・グローブ',
      vendor: '日本オーチス・エレベータ㈱',
      planType: '不明', planLabel: '', unitCount: 1,
      inspectionFrequency: '', remoteMonitoring: true, spec: '遠隔監視装置付き',
      monthlyFee: null, monthlyFeeTaxIncluded: null, annualFee: null,
      termFrom: '', termTo: '', autoRenew: null, cancellationNotice: '',
      statutoryInspectionIncluded: null, exclusions: [],
      units: [{
        unitNo: '1号機', kind: 'エレベーター', maker: 'オーチス', model: 'GeN2',
        serialNo: 'OT-114523', installedOn: '2008-09',
        capacityKg: 750, capacityPersons: 11, ratedSpeed: 60, stops: 6,
        inspectionDate: '2026-04-18', inspector: '（一財）岡山県建築住宅センター',
        findings: [
          { rank: '要重点点検', item: '主索の摩耗', detail: '素線切れは無いが直径の減少が進行' },
          { rank: '指摘なし', item: '戸開走行保護装置', detail: '' }
        ]
      }],
      evidence: [
        '昇降機の種類 エレベーター（乗用）　製造者 日本オーチス・エレベータ株式会社',
        '積載量 750kg　最大定員 11人　定格速度 60m/min',
        '停止階数 6　検査年月日 令和8年4月18日',
        '保守点検業者 日本オーチス・エレベータ株式会社'
      ],
      warnings: ['保守料金の記載は報告書にありません']
    },
    {
      fileName: '保守契約書_サンエイ玉野店.pdf',
      docType: '保守契約書',
      confidence: 0.86,
      buildingName: 'サンエイ玉野店',
      buildingAddress: '',
      owner: '株式会社リー・グローブ',
      vendor: '日本オーチス・エレベータ㈱',
      planType: 'FM契約', planLabel: 'フルメンテナンス契約',
      unitCount: 1,
      inspectionFrequency: '不明',
      remoteMonitoring: true, spec: '遠隔監視装置付き',
      monthlyFee: 58000, monthlyFeeTaxIncluded: false, annualFee: 696000,
      termFrom: '2024-04-01', termTo: '2027-03-31',
      autoRenew: true, cancellationNotice: '3ヶ月前',
      statutoryInspectionIncluded: true,
      exclusions: ['天災・火災による損傷', '故意または過失による損傷'],
      units: [],
      evidence: [
        '保守料金 月額 金58,000円（消費税別）',
        '契約期間 令和6年4月1日から令和9年3月31日まで',
        '期間満了の3ヶ月前までに申出のないときは、同一条件でさらに1年間更新する',
        '年1回の定期検査報告に要する費用は保守料金に含むものとする'
      ],
      warnings: ['点検周期の記載が見当たらないため、点検頻度は「不明」としました']
    }
  ];

  global.Ai = {
    async extract(files) {
      await new Promise(function (r) { setTimeout(r, 1400); });
      return { documents: SAMPLE, usage: null, demo: true };
    },
    SAMPLE: SAMPLE
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
