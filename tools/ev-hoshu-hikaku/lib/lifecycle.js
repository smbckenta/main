/*
 * 昇降機の年次まわり。
 *
 *   - 確認済証交付年月などを西暦・和暦の両方で表示する
 *   - その年月からの経過年数を出す
 *   - リニューアル済みなら「最後のリニューアル年月」を起点に数え直す
 *   - 起点から25年経過したらアラートにする
 *
 * 和暦は Intl の和暦カレンダーに任せる（元年表記も含めて正しく出る）。
 */
(function (global) {
  'use strict';

  var RENEWAL_CYCLE_YEARS = 25;

  // 入力を受けるための元号表（報告書は和暦表記なので手入力も通せるようにする）
  var ERAS = [
    { names: ['令和', 'R', 'r'], start: [2019, 5, 1] },
    { names: ['平成', 'H', 'h'], start: [1989, 1, 8] },
    { names: ['昭和', 'S', 's'], start: [1926, 12, 25] },
    { names: ['大正', 'T', 't'], start: [1912, 7, 30] },
    { names: ['明治', 'M', 'm'], start: [1868, 9, 8] }
  ];

  function toHalfWidth(s) {
    return String(s).replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
  }

  /**
   * 「2003-04」「2003/4/1」「平成15年4月」「H15.4」などを {y, m, d} にする。
   * 読めなければ null。日が無い場合 d は null。
   */
  function parseYm(input) {
    if (!input) return null;
    var s = toHalfWidth(String(input)).trim();
    if (!s) return null;

    for (var i = 0; i < ERAS.length; i++) {
      var era = ERAS[i];
      for (var j = 0; j < era.names.length; j++) {
        var name = era.names[j];
        var re = new RegExp('^' + name + '\\s*(元|\\d{1,2})\\s*[年.\\-/]\\s*(\\d{1,2})\\s*(?:[月.\\-/]\\s*(\\d{1,2})\\s*日?)?');
        var m = re.exec(s);
        if (!m) continue;
        var n = m[1] === '元' ? 1 : Number(m[1]);
        return {
          y: era.start[0] + n - 1,
          m: Number(m[2]),
          d: m[3] ? Number(m[3]) : null
        };
      }
    }

    var g = /^(\d{4})\s*[年.\-/]\s*(\d{1,2})(?:\s*[月.\-/]\s*(\d{1,2}))?/.exec(s);
    if (!g) return null;
    var mm = Number(g[2]);
    if (mm < 1 || mm > 12) return null;
    return { y: Number(g[1]), m: mm, d: g[3] ? Number(g[3]) : null };
  }

  // 保存用の正規形。日まで分かっていれば残す。
  function toIso(ym) {
    if (!ym) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return ym.y + '-' + p(ym.m) + (ym.d ? '-' + p(ym.d) : '');
  }

  function normalize(input) {
    return toIso(parseYm(input));
  }

  function toDate(ym, defaultDay) {
    return new Date(Date.UTC(ym.y, ym.m - 1, ym.d || defaultDay || 1));
  }

  var warekiFormat = null;
  function wareki(input) {
    var ym = parseYm(input);
    if (!ym) return '';
    try {
      if (!warekiFormat) {
        warekiFormat = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
          era: 'long', year: 'numeric', month: 'long', timeZone: 'UTC'
        });
      }
      // 日が不明なときは月の中日で判定する。改元月でも、その月の大半を
      // 占めるほうの元号になる（例: 1989-01 は昭和64年ではなく平成元年）。
      return warekiFormat.format(toDate(ym, 15));
    } catch (e) {
      return '';
    }
  }

  function seireki(input) {
    var ym = parseYm(input);
    if (!ym) return '';
    return ym.y + '年' + ym.m + '月' + (ym.d ? ym.d + '日' : '');
  }

  /** 「2003年4月（平成15年4月）」 */
  function both(input) {
    var s = seireki(input);
    if (!s) return '';
    var w = wareki(input);
    return w ? s + '（' + w + '）' : s;
  }

  /** 起点から今日までの経過。読めなければ null。 */
  function elapsed(input, now) {
    var ym = parseYm(input);
    if (!ym) return null;
    var today = now ? new Date(now) : new Date();
    var months = (today.getFullYear() - ym.y) * 12 + (today.getMonth() + 1 - ym.m);
    if (ym.d && today.getDate() < ym.d) months -= 1;
    if (months < 0) months = 0;
    return { totalMonths: months, years: Math.floor(months / 12), months: months % 12 };
  }

  function lastRenewal(unit) {
    var list = (unit && unit.renewals ? unit.renewals : [])
      .map(function (r) { return typeof r === 'string' ? { on: r } : r; })
      .filter(function (r) { return r && parseYm(r.on); })
      .sort(function (a, b) { return toIso(parseYm(a.on)) < toIso(parseYm(b.on)) ? -1 : 1; });
    return list.length ? list[list.length - 1] : null;
  }

  /**
   * 更新時期の判定。
   * 起点はリニューアル済みなら最後のリニューアル年月、無ければ確認済証交付年月。
   * どちらも無いときは製造年月・設置年月で代用し、その旨を basis で返す。
   */
  function assess(unit, now, cycleYears) {
    var cycle = cycleYears || RENEWAL_CYCLE_YEARS;
    var renewal = lastRenewal(unit);
    var basis, baseOn;

    if (renewal) {
      basis = 'renewal';
      baseOn = renewal.on;
    } else if (parseYm(unit && unit.confirmationCertificateOn)) {
      basis = 'confirmation';
      baseOn = unit.confirmationCertificateOn;
    } else if (parseYm(unit && unit.manufacturedOn)) {
      basis = 'manufactured';
      baseOn = unit.manufacturedOn;
    } else if (parseYm(unit && unit.installedOn)) {
      basis = 'installed';
      baseOn = unit.installedOn;
    } else {
      return { basis: 'unknown', baseOn: '', elapsed: null, alert: false, renewal: renewal };
    }

    var e = elapsed(baseOn, now);
    var remainingMonths = cycle * 12 - e.totalMonths;
    return {
      basis: basis,
      baseOn: baseOn,
      elapsed: e,
      cycleYears: cycle,
      alert: e.totalMonths >= cycle * 12,
      remainingMonths: remainingMonths,
      remainingYears: Math.max(0, Math.ceil(remainingMonths / 12)),
      renewal: renewal
    };
  }

  var BASIS_LABEL = {
    renewal: '最終リニューアル',
    confirmation: '確認済証交付',
    manufactured: '製造',
    installed: '設置',
    unknown: '不明'
  };

  global.Lifecycle = {
    RENEWAL_CYCLE_YEARS: RENEWAL_CYCLE_YEARS,
    BASIS_LABEL: BASIS_LABEL,
    parseYm: parseYm,
    normalize: normalize,
    wareki: wareki,
    seireki: seireki,
    both: both,
    elapsed: elapsed,
    lastRenewal: lastRenewal,
    assess: assess
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.Lifecycle;
