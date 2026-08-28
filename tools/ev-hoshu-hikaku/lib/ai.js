/*
 * 定期検査報告書・保守契約書を Claude に読ませて、比較表の行に使える形で取り出す。
 *
 * 複合機ツールと同じ方針:
 *   - 読み取れなかった項目は空のままにして推測しない
 *   - 根拠 (evidence) として原文の該当行をそのまま持ち帰る
 *   - 判断に迷った点は warnings に残し、画面に出して人が確認する
 *
 * ブラウザから直接 API を叩くため、SDK ではなく fetch を使う（ビルド工程を持たない）。
 */
(function (global) {
  'use strict';

  var ENDPOINT = 'https://api.anthropic.com/v1/messages';
  var API_VERSION = '2023-06-01';

  var FINDING = {
    type: 'object',
    properties: {
      rank: { type: 'string', enum: ['要是正', '要重点点検', '指摘なし', '不明'] },
      item: { type: 'string' },
      detail: { type: 'string' }
    },
    required: ['rank', 'item', 'detail'],
    additionalProperties: false
  };

  var UNIT = {
    type: 'object',
    properties: {
      unitNo: { type: 'string', description: '号機番号。例「1号機」' },
      kind: { type: 'string', enum: ['エレベーター', 'エスカレーター', '小荷物専用昇降機', '不明'] },
      maker: { type: 'string', description: '製造者。「三菱電機」は「三菱」のように通称でよい' },
      model: { type: 'string' },
      serialNo: { type: 'string' },
      installedOn: { type: 'string', description: '設置年月。YYYY-MM 形式。不明なら空' },
      capacityKg: { type: ['number', 'null'] },
      capacityPersons: { type: ['number', 'null'] },
      ratedSpeed: { type: ['number', 'null'], description: '定格速度 m/min' },
      stops: { type: ['number', 'null'], description: '停止階数' },
      inspectionDate: { type: 'string', description: '検査年月日。YYYY-MM-DD 形式' },
      inspector: { type: 'string', description: '検査者氏名または検査機関' },
      findings: { type: 'array', items: FINDING }
    },
    required: ['unitNo', 'kind', 'maker', 'model', 'serialNo', 'installedOn',
      'capacityKg', 'capacityPersons', 'ratedSpeed', 'stops',
      'inspectionDate', 'inspector', 'findings'],
    additionalProperties: false
  };

  var DOCUMENT = {
    type: 'object',
    properties: {
      fileName: { type: 'string' },
      docType: { type: 'string', enum: ['定期検査報告書', '保守契約書', '見積書', '請求書', 'その他'] },
      confidence: { type: 'number', description: '読み取りの確からしさ 0.0-1.0' },
      buildingName: { type: 'string', description: '建物名・設置場所名' },
      buildingAddress: { type: 'string' },
      owner: { type: 'string', description: '所有者・管理者・契約者名' },
      vendor: { type: 'string', description: '保守点検業者名' },
      planType: { type: 'string', enum: ['POG契約', 'FM契約', 'その他', '不明'] },
      planLabel: { type: 'string', description: '契約書上の呼称をそのまま' },
      unitCount: { type: ['number', 'null'], description: '契約対象の台数' },
      inspectionFrequency: { type: 'string', description: '例「有人点検\n1回/2ヶ月」。改行込みで比較表にそのまま入る形にする' },
      remoteMonitoring: { type: ['boolean', 'null'] },
      spec: { type: 'string', description: '仕様欄に書く内容。例「遠隔監視装置付き」' },
      monthlyFee: { type: ['number', 'null'], description: '月額保守料金（税抜・契約全体）' },
      monthlyFeeTaxIncluded: { type: ['boolean', 'null'], description: 'monthlyFee が税込なら true' },
      annualFee: { type: ['number', 'null'] },
      termFrom: { type: 'string' },
      termTo: { type: 'string' },
      autoRenew: { type: ['boolean', 'null'] },
      cancellationNotice: { type: 'string', description: '解約予告期間' },
      statutoryInspectionIncluded: { type: ['boolean', 'null'], description: '法定検査（定期検査報告）費用が月額に含まれるか' },
      exclusions: { type: 'array', items: { type: 'string' }, description: '保守対象外の項目' },
      units: { type: 'array', items: UNIT },
      evidence: { type: 'array', items: { type: 'string' }, description: '判断の根拠になった原文の行をそのまま' },
      warnings: { type: 'array', items: { type: 'string' } }
    },
    required: ['fileName', 'docType', 'confidence', 'buildingName', 'buildingAddress', 'owner',
      'vendor', 'planType', 'planLabel', 'unitCount', 'inspectionFrequency', 'remoteMonitoring',
      'spec', 'monthlyFee', 'monthlyFeeTaxIncluded', 'annualFee', 'termFrom', 'termTo',
      'autoRenew', 'cancellationNotice', 'statutoryInspectionIncluded', 'exclusions',
      'units', 'evidence', 'warnings'],
    additionalProperties: false
  };

  var SCHEMA = {
    type: 'object',
    properties: { documents: { type: 'array', items: DOCUMENT } },
    required: ['documents'],
    additionalProperties: false
  };

  var SYSTEM = [
    'あなたは昇降機（エレベーター・エスカレーター）の保守契約を扱う実務担当者です。',
    '渡された書類から、保守料金の比較表を作るのに必要な情報を読み取ります。',
    '',
    '守ること:',
    '- 書類に書かれていないことは推測しない。読み取れない項目は空文字または null にする。',
    '- 金額は税抜を基本とする。書類が税込のときは monthlyFeeTaxIncluded を true にし、',
    '  warnings に「税込表記」と明記する。値そのものは書類のまま変換しない。',
    '- 複数号機がある場合は units に号機ごとに分けて入れる。',
    '- inspectionFrequency は比較表の欄にそのまま入る短い表記にする。',
    '  有人点検の周期が分かるときは「有人点検」と周期を改行で区切る（例:「有人点検\\n1回/2ヶ月」）。',
    '  周期が読み取れないときは「不明」とする。',
    '- spec は仕様欄に入る短い表記。遠隔監視が付くなら「遠隔監視装置付き」。',
    '- evidence には判断の根拠になった行を書類の原文のまま入れる。要約しない。',
    '- 判断に迷った点、書類間で食い違う点、単位や期間の解釈は warnings に残す。',
    '- 定期検査報告書の指摘事項は findings に「要是正」「要重点点検」で分けて入れる。'
  ].join('\n');

  function b64(bytes) {
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  function blockFor(file, bytes) {
    var type = file.type || '';
    if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      return {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64(bytes) }
      };
    }
    var image = /^image\/(png|jpeg|gif|webp)$/.test(type) ? type
      : /\.png$/i.test(file.name) ? 'image/png'
        : /\.(jpe?g)$/i.test(file.name) ? 'image/jpeg'
          : /\.webp$/i.test(file.name) ? 'image/webp' : null;
    if (image) {
      return { type: 'image', source: { type: 'base64', media_type: image, data: b64(bytes) } };
    }
    return null;
  }

  /**
   * files: [{ file: File, bytes: Uint8Array }]
   * options: { apiKey, model, signal }
   */
  async function extract(files, options) {
    if (!options.apiKey) throw new Error('API キーが設定されていません（data/api-key.txt）');
    if (!files.length) throw new Error('読み取る書類がありません');

    var content = [];
    var skipped = [];
    files.forEach(function (f) {
      var block = blockFor(f.file, f.bytes);
      if (!block) { skipped.push(f.file.name); return; }
      content.push({ type: 'text', text: '── ファイル: ' + f.file.name });
      content.push(block);
    });
    if (!content.length) {
      throw new Error('対応していない形式です（PDF・PNG・JPEG のいずれかにしてください）');
    }

    content.push({
      type: 'text',
      text: [
        '上の書類それぞれについて、比較表に必要な情報を読み取ってください。',
        'documents の各要素の fileName は、上に示したファイル名をそのまま入れてください。',
        '1つのファイルに複数物件が載っている場合も、documents は1ファイル1件にまとめ、',
        '物件・号機の違いは units に分けてください。'
      ].join('\n')
    });

    var body = {
      model: options.model || 'claude-opus-5',
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: SCHEMA }
      },
      messages: [{ role: 'user', content: content }]
    };

    var res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body),
      signal: options.signal
    });

    if (!res.ok) {
      var detail = await res.text().catch(function () { return ''; });
      throw new Error('Claude API エラー (' + res.status + '): ' + detail.slice(0, 400));
    }

    var json = await res.json();
    if (json.stop_reason === 'refusal') {
      throw new Error('この書類は読み取りを断られました（stop_reason: refusal）');
    }

    var text = (json.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('応答を JSON として読めませんでした: ' + text.slice(0, 300));
    }

    var documents = parsed.documents || [];
    if (skipped.length) {
      documents.push({
        fileName: skipped.join(', '),
        docType: 'その他',
        confidence: 0,
        warnings: ['対応していない形式のため読み取っていません'],
        units: [], evidence: [], exclusions: []
      });
    }
    return { documents: documents, usage: json.usage || null };
  }

  global.Ai = { extract: extract, SCHEMA: SCHEMA };
})(typeof globalThis !== 'undefined' ? globalThis : this);
