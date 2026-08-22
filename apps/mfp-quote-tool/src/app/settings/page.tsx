"use client";

import { useEffect, useState } from "react";
import { MAKERS, MAKER_LABELS, type CounterTier, type Maker, type Settings } from "@/lib/types";

/** 画面用：設定 + 削除パスワードが設定済みか + 新しいパスワード */
type SettingsForm = Settings & { deletionPasswordSet?: boolean; newDeletionPassword?: string };

/** 自社情報・リース料率・カウンター単価ルール・PTFの設定 */
export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsForm | null>(null);
  const [message, setMessage] = useState("");
  const [logo, setLogo] = useState<{ file: string | null; dataUri: string | null }>({
    file: null,
    dataUri: null,
  });
  const [registerTest, setRegisterTest] = useState<string>("");
  /** サービスアカウント鍵の状態（置いてあれば、共有すべきメールアドレスが分かる） */
  const [serviceAccount, setServiceAccount] = useState<{ hasKey: boolean; email: string | null }>({
    hasKey: false,
    email: null,
  });

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setSettings);
    fetch("/api/logo").then((r) => r.json()).then(setLogo).catch(() => {});
    fetch("/api/register/test").then((r) => r.json()).then(setServiceAccount).catch(() => {});
  }, []);

  /** 台帳につながるかを試す（保存前の入力内容で試せる） */
  async function testRegister() {
    if (!settings) return;
    setRegisterTest("確認中…");
    try {
      const res = await fetch("/api/register/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings.quoteRegister),
      });
      const json = await res.json();
      setRegisterTest(
        json.ok
          ? `つながりました。「${json.sheetName}」シート：番号 ${json.rows.toLocaleString()} 行／空き ${json.vacantCount.toLocaleString()} 件。次に使う番号は ${json.nextNumbers.join("、") || "（空きがありません）"} です。`
          : `つながりませんでした：${json.error}`,
      );
    } catch (err) {
      setRegisterTest(`つながりませんでした：${(err as Error).message}`);
    }
  }

  async function uploadLogo(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/logo", { method: "POST", body: form });
    const json = await res.json();
    if (res.ok) {
      setLogo(json);
      setMessage("ロゴを差し替えました。");
    } else {
      setMessage(json.error ?? "ロゴの差し替えに失敗しました。");
    }
  }

  async function save() {
    if (!settings) return;
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      // 保存後は入力欄のパスワードを消し、設定済み表示に切り替える
      setSettings(await res.json());
      setMessage("保存しました。");
    } else {
      setMessage("保存に失敗しました。");
    }
  }

  if (!settings) return <p className="spinner">読み込み中…</p>;
  const s = settings;
  const set = (patch: Partial<SettingsForm>) => setSettings({ ...s, ...patch });

  const tierTable = (
    key: "counterTiersByColorVolume" | "counterTiersByAmount",
    label: string,
    unit: string,
  ) => (
    <>
      <h3>{label}</h3>
      <table style={{ maxWidth: 620 }}>
        <thead>
          <tr>
            <th className="num">下限（{unit}）</th>
            <th className="num">上限（{unit}）</th>
            <th className="num">モノクロ単価</th>
            <th className="num">カラー単価</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s[key].map((t: CounterTier, i: number) => (
            <tr key={i}>
              <td>
                <input
                  type="number"
                  value={t.min}
                  onChange={(e) => updateTier(key, i, { min: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={t.max ?? ""}
                  placeholder="上限なし"
                  onChange={(e) =>
                    updateTier(key, i, { max: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={t.mono}
                  onChange={(e) => updateTier(key, i, { mono: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={t.color}
                  onChange={(e) => updateTier(key, i, { color: Number(e.target.value) })}
                />
              </td>
              <td>
                <button className="danger" onClick={() => set({ [key]: s[key].filter((_, j) => j !== i) } as Partial<Settings>)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="secondary"
        style={{ marginTop: 8 }}
        onClick={() => set({ [key]: [...s[key], { min: 0, max: null, mono: 0, color: 0 }] } as Partial<Settings>)}
      >
        段を追加
      </button>
    </>
  );

  function updateTier(
    key: "counterTiersByColorVolume" | "counterTiersByAmount",
    index: number,
    patch: Partial<CounterTier>,
  ) {
    set({
      [key]: s[key].map((t, i) => (i === index ? { ...t, ...patch } : t)),
    } as Partial<Settings>);
  }

  return (
    <>
      <section className="panel">
        <h2>自社情報（見積書に印字）</h2>
        <div className="row">
          <Field label="会社名" width={220}>
            <input value={s.company.name} onChange={(e) => set({ company: { ...s.company, name: e.target.value } })} />
          </Field>
          <Field label="代表者" width={220}>
            <input
              value={s.company.representative ?? ""}
              onChange={(e) => set({ company: { ...s.company, representative: e.target.value } })}
            />
          </Field>
          <Field label="TEL" width={140}>
            <input value={s.company.tel ?? ""} onChange={(e) => set({ company: { ...s.company, tel: e.target.value } })} />
          </Field>
          <Field label="FAX" width={140}>
            <input value={s.company.fax ?? ""} onChange={(e) => set({ company: { ...s.company, fax: e.target.value } })} />
          </Field>
          <Field label="拠点名" width={140}>
            <input
              value={s.company.branchNote ?? ""}
              onChange={(e) => set({ company: { ...s.company, branchNote: e.target.value } })}
            />
          </Field>
          <Field label="住所（拠点を使わない場合）" width={320}>
            <input
              value={s.company.address ?? ""}
              onChange={(e) => set({ company: { ...s.company, address: e.target.value } })}
            />
          </Field>
          <Field label="備考（営業拠点）" width={280}>
            <input
              value={s.company.areaNote ?? ""}
              onChange={(e) => set({ company: { ...s.company, areaNote: e.target.value } })}
            />
          </Field>
          <Field label="有効期限" width={160}>
            <input
              value={s.company.validityText}
              onChange={(e) => set({ company: { ...s.company, validityText: e.target.value } })}
            />
          </Field>
          <Field label="消費税率(%)" width={110}>
            <input
              type="number"
              step="1"
              value={Math.round(s.company.taxRate * 100)}
              onChange={(e) => set({ company: { ...s.company, taxRate: Number(e.target.value) / 100 } })}
            />
          </Field>
        </div>
      </section>

      <section className="panel">
        <h2>ロゴ（見積書・比較表に印字）</h2>
        <p className="muted">
          PNG / JPEG / SVG に対応しています。差し替えると、以後の見積書・比較表すべてに反映されます。
          Excel出力に載せる場合は PNG か JPEG にしてください。
        </p>
        <div className="row" style={{ alignItems: "center" }}>
          {logo.dataUri && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo.dataUri}
              alt="ロゴ"
              style={{ maxHeight: 56, maxWidth: 280, border: "1px solid #ddd", padding: 4, background: "#fff" }}
            />
          )}
          <div className="field" style={{ width: 300 }}>
            <label>ロゴ画像を差し替える</label>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.svg,image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
            />
            <span className="muted">現在のファイル：{logo.file ?? "未設定"}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>拠点（見積書・比較表に印字）</h2>
        <div className="row">
          {(s.company.offices ?? []).map((o, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <div className="field" style={{ width: 140 }}>
                <label>拠点名{i + 1}</label>
                <input
                  value={o.name}
                  onChange={(e) =>
                    set({
                      company: {
                        ...s.company,
                        offices: (s.company.offices ?? []).map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      },
                    })
                  }
                />
              </div>
              <div className="field" style={{ width: 380 }}>
                <label>所在地</label>
                <div className="row" style={{ gap: 4 }}>
                  <input
                    value={o.address}
                    onChange={(e) =>
                      set({
                        company: {
                          ...s.company,
                          offices: (s.company.offices ?? []).map((x, j) =>
                            j === i ? { ...x, address: e.target.value } : x,
                          ),
                        },
                      })
                    }
                  />
                  <button
                    className="danger"
                    onClick={() =>
                      set({
                        company: {
                          ...s.company,
                          offices: (s.company.offices ?? []).filter((_, j) => j !== i),
                        },
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          className="secondary"
          style={{ marginTop: 8 }}
          onClick={() =>
            set({ company: { ...s.company, offices: [...(s.company.offices ?? []), { name: "", address: "" }] } })
          }
        >
          拠点を追加
        </button>
      </section>

      <section className="panel">
        <h2>リース料率</h2>
        <div className="row">
          {Object.entries(s.leaseRates)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([term, rate]) => (
              <Field key={term} label={`${Math.round(Number(term) / 12)}年（${term}回）%`} width={150}>
                <input
                  type="number"
                  step="0.001"
                  value={Number((rate * 100).toFixed(3))}
                  onChange={(e) =>
                    set({ leaseRates: { ...s.leaseRates, [term]: Number(e.target.value) / 100 } })
                  }
                />
              </Field>
            ))}
          <Field label="見積金額の端数単位（円）" width={170}>
            <input type="number" value={s.roundUnit} onChange={(e) => set({ roundUnit: Number(e.target.value) })} />
          </Field>
          <Field label="月額リース料の切り上げ単位（円）" width={220}>
            <input
              type="number"
              value={s.leaseRoundUnit}
              onChange={(e) => set({ leaseRoundUnit: Number(e.target.value) })}
            />
          </Field>
          <Field label="既定のGP（円）" width={160}>
            <input
              type="number"
              step="10000"
              value={s.defaultGrossProfit}
              onChange={(e) => set({ defaultGrossProfit: Number(e.target.value) })}
            />
          </Field>
          <Field label="既定の粗利率(%)" width={150}>
            <input
              type="number"
              step="0.1"
              value={Number((s.defaultMarginRate * 100).toFixed(1))}
              onChange={(e) => set({ defaultMarginRate: Number(e.target.value) / 100 })}
            />
          </Field>
        </div>

        <h3>旧リースの残債精算</h3>
        <div className="row">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={s.debtSettlement.includeInQuote}
              onChange={(e) =>
                set({ debtSettlement: { ...s.debtSettlement, includeInQuote: e.target.checked } })
              }
            />
            残債と解約事務手数料を見積金額に含める
          </label>
          <Field label="解約事務手数料（リース料の月数）" width={230}>
            <input
              type="number"
              value={s.debtSettlement.cancellationMonths}
              onChange={(e) =>
                set({
                  debtSettlement: { ...s.debtSettlement, cancellationMonths: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
        <p className="muted">
          残債がある案件では「残債 ＋ 現行リース料 × 上記の月数」を見積金額（リース対象額）に上乗せします。
          この上乗せ分はPTFの計算対象になりません。
        </p>
      </section>

      <section className="panel">
        <h2>カウンター単価の自動判定</h2>
        <div className="row">
          <Field label="判定の基準" width={260}>
            <select
              value={s.counterBasis}
              onChange={(e) => set({ counterBasis: e.target.value as Settings["counterBasis"] })}
            >
              <option value="colorVolume">月間カラー印刷枚数で判定</option>
              <option value="counterAmount">現行のカウンター請求額で判定</option>
            </select>
          </Field>
          <Field label="2色カラー係数（カラー単価×）" width={220}>
            <input
              type="number"
              step="0.01"
              value={s.twoColorRatio}
              onChange={(e) => set({ twoColorRatio: Number(e.target.value) })}
            />
          </Field>
          <Field label="最低基本料金の既定値（円/月）" width={220}>
            <input
              type="number"
              value={s.defaultMinCharge}
              onChange={(e) => set({ defaultMinCharge: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="muted">
          最低基本料金はメーカー別の設定（仕切表）が優先されます。現在：京セラ 2,000円／東芝 1,500円／
          その他メーカーは都度メーカー条件を確認して案件ごとに入力。
        </p>
        <div className="row">
          <Field label="当日対応エリアの基準単価（モノクロ）" width={230}>
            <input
              type="number"
              step="0.01"
              value={s.sameDayBaseUnits.mono}
              onChange={(e) =>
                set({ sameDayBaseUnits: { ...s.sameDayBaseUnits, mono: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="当日対応エリアの基準単価（カラー）" width={230}>
            <input
              type="number"
              step="0.01"
              value={s.sameDayBaseUnits.color}
              onChange={(e) =>
                set({ sameDayBaseUnits: { ...s.sameDayBaseUnits, color: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
        <p className="muted">
          保守ランク S・A（当日対応可）のエリアでは、印刷枚数が少なくてもこの単価まで提示できるものとして自動判定します。
          ランクB以下・離島は、メーカー交渉レンジの上限側の単価になります。
        </p>
        {tierTable("counterTiersByColorVolume", "カラー印刷枚数による単価表", "枚")}
        {tierTable("counterTiersByAmount", "カウンター請求額による単価表", "円")}
        <p className="muted">
          自動判定した単価は、仕切表に登録したメーカーごとの交渉レンジに収められます。
          エリアが「僻地」の場合はレンジ上限側の単価になります。
        </p>
      </section>

      <section className="panel">
        <h2>2色カラーの単価</h2>
        <p className="muted">
          メーカー別に単価を決めている場合はここに入れます（京セラは2.0円）。
          空欄のメーカーは「フルカラー単価 × 係数」で計算します。
        </p>
        <div className="row">
          <Field label="係数（空欄のメーカー用）" width={200}>
            <input
              type="number"
              step="0.01"
              value={s.twoColorRatio}
              onChange={(e) => set({ twoColorRatio: Number(e.target.value) })}
            />
          </Field>
          {MAKERS.map((maker: Maker) => (
            <Field key={maker} label={`${MAKER_LABELS[maker]}（円/枚）`} width={130}>
              <input
                type="number"
                step="0.01"
                placeholder="係数で計算"
                value={s.twoColorUnitByMaker?.[maker] ?? ""}
                onChange={(e) => {
                  const next = { ...(s.twoColorUnitByMaker ?? {}) };
                  if (e.target.value === "") delete next[maker];
                  else next[maker] = Number(e.target.value);
                  set({ twoColorUnitByMaker: next });
                }}
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>機種グレードの推奨（月間総印刷枚数 → 〇〇枚機）</h2>
        <table style={{ maxWidth: 420 }}>
          <thead>
            <tr>
              <th className="num">枚数（以上）</th>
              <th className="num">推奨グレード（枚機）</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.gradeTiers.map((g, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="number"
                    value={g.minPages}
                    onChange={(e) =>
                      set({
                        gradeTiers: s.gradeTiers.map((x, j) =>
                          i === j ? { ...x, minPages: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={g.ppm}
                    onChange={(e) =>
                      set({
                        gradeTiers: s.gradeTiers.map((x, j) => (i === j ? { ...x, ppm: Number(e.target.value) } : x)),
                      })
                    }
                  />
                </td>
                <td>
                  <button className="danger" onClick={() => set({ gradeTiers: s.gradeTiers.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="secondary"
          style={{ marginTop: 8 }}
          onClick={() => set({ gradeTiers: [...s.gradeTiers, { minPages: 0, ppm: 25 }] })}
        >
          段を追加
        </button>
      </section>

      <section className="panel">
        <h2>エリア</h2>
        <table style={{ maxWidth: 560 }}>
          <thead>
            <tr>
              <th>エリア名</th>
              <th>僻地扱い</th>
              <th className="num">モノクロ加算</th>
              <th className="num">カラー加算</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.areas.map((a, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={a.name}
                    onChange={(e) =>
                      set({ areas: s.areas.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={a.remote}
                    onChange={(e) =>
                      set({ areas: s.areas.map((x, j) => (i === j ? { ...x, remote: e.target.checked } : x)) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={a.monoAdd ?? 0}
                    onChange={(e) =>
                      set({ areas: s.areas.map((x, j) => (i === j ? { ...x, monoAdd: Number(e.target.value) } : x)) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={a.colorAdd ?? 0}
                    onChange={(e) =>
                      set({ areas: s.areas.map((x, j) => (i === j ? { ...x, colorAdd: Number(e.target.value) } : x)) })
                    }
                  />
                </td>
                <td>
                  <button className="danger" onClick={() => set({ areas: s.areas.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="secondary"
          style={{ marginTop: 8 }}
          onClick={() => set({ areas: [...s.areas, { name: "", remote: false }] })}
        >
          エリアを追加
        </button>
      </section>

      <section className="panel">
        <h2>PTF（代理店報酬）の計算</h2>
        <p className="muted">
          既定は「本体価格の10%」です。フィニッシャー・ICカードリーダー等のオプションや、
          追加のPC設定作業として本体価格に上乗せした分（見積明細で「PTF対象外」にした行）には料率を適用しません。
        </p>
        <div className="row">
          <Field label="計算のベース" width={260}>
            <select value={s.ptf.base} onChange={(e) => set({ ptf: { ...s.ptf, base: e.target.value as Settings["ptf"]["base"] } })}>
              <option value="bodyPrice">本体価格（上乗せ分を除く）に対する率</option>
              <option value="grossProfit">GPに対する率</option>
              <option value="sellingPrice">販売額計（上乗せ分を含む）に対する率</option>
              <option value="fixed">固定額のみ</option>
            </select>
          </Field>
          <Field label="率(%)" width={110}>
            <input
              type="number"
              step="0.1"
              value={Number((s.ptf.rate * 100).toFixed(1))}
              onChange={(e) => set({ ptf: { ...s.ptf, rate: Number(e.target.value) / 100 } })}
            />
          </Field>
          <Field label="固定加算額（円）" width={150}>
            <input
              type="number"
              value={s.ptf.fixed}
              onChange={(e) => set({ ptf: { ...s.ptf, fixed: Number(e.target.value) } })}
            />
          </Field>
          <Field label="上限額（0で無制限）" width={170}>
            <input
              type="number"
              value={s.ptf.cap}
              onChange={(e) => set({ ptf: { ...s.ptf, cap: Number(e.target.value) } })}
            />
          </Field>
          <Field label="端数処理単位（円）" width={160}>
            <input
              type="number"
              value={s.ptf.roundUnit}
              onChange={(e) => set({ ptf: { ...s.ptf, roundUnit: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={s.ptf.counter.enabled}
              onChange={(e) => set({ ptf: { ...s.ptf, counter: { ...s.ptf.counter, enabled: e.target.checked } } })}
            />
            カウンター分の報酬も加算する
          </label>
          <Field label="カウンター率(%)" width={140}>
            <input
              type="number"
              step="0.1"
              value={Number((s.ptf.counter.rate * 100).toFixed(1))}
              onChange={(e) =>
                set({ ptf: { ...s.ptf, counter: { ...s.ptf.counter, rate: Number(e.target.value) / 100 } } })
              }
            />
          </Field>
          <Field label="対象月数" width={120}>
            <input
              type="number"
              value={s.ptf.counter.months}
              onChange={(e) =>
                set({ ptf: { ...s.ptf, counter: { ...s.ptf.counter, months: Number(e.target.value) } } })
              }
            />
          </Field>
        </div>
      </section>

      <section className="panel">
        <h2>AIによる書類の読み取り</h2>
        <p className="muted">
          アップロードしたPDF・写真をAI（Claude）がそのまま読み取ります。
          文字起こし（OCR）では崩れてしまうスキャン書類・スマホ写真でも、表の意味を踏まえて枚数・単価・リース料を拾えます。
          APIキーは <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">Claude Console</a> で発行してください。
        </p>
        <div className="row">
          <Field label="AIで読み取る" width={160}>
            <select
              value={s.ai.enabled ? "1" : "0"}
              onChange={(e) => set({ ai: { ...s.ai, enabled: e.target.value === "1" } })}
            >
              <option value="1">使う（推奨）</option>
              <option value="0">使わない（OCRのみ）</option>
            </select>
          </Field>
          <Field label="APIキー" width={360}>
            <input
              type="password"
              value={s.ai.apiKey}
              placeholder="sk-ant-... （空欄なら環境変数 ANTHROPIC_API_KEY を使用）"
              onChange={(e) => set({ ai: { ...s.ai, apiKey: e.target.value } })}
            />
          </Field>
          <Field label="モデル" width={200}>
            <input value={s.ai.model} onChange={(e) => set({ ai: { ...s.ai, model: e.target.value } })} />
          </Field>
          <Field label="1ファイルの最大ページ数" width={180}>
            <input
              type="number"
              value={s.ai.maxPages}
              onChange={(e) => set({ ai: { ...s.ai, maxPages: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <p className="warn" style={{ marginTop: 10 }}>
          APIキーは設定ファイル（settings.json）に保存されます。保存先を共有ドライブにしている場合は、
          共有相手にもキーが見えることにご注意ください。共有したくない場合は空欄のままにして、
          環境変数 ANTHROPIC_API_KEY で渡してください。
          <br />
          読み取りにはお客様の書類がAnthropicのAPIへ送信されます（学習には使われません）。
          利用料はA4数枚の書類1件あたり数円〜十数円が目安です。
        </p>
      </section>

      <section className="panel">
        <h2>担当者（見積書に印字・削除記録に使う）</h2>
        <p className="muted">案件ごとに担当者を選ぶと、御見積書に「担当者：〇〇」と入ります。</p>
        <div className="row">
          {s.staff.map((name, i) => (
            <div className="field" key={i} style={{ width: 200 }}>
              <label>担当者{i + 1}</label>
              <div className="row" style={{ gap: 4 }}>
                <input
                  value={name}
                  onChange={(e) => set({ staff: s.staff.map((v, j) => (j === i ? e.target.value : v)) })}
                />
                <button className="danger" onClick={() => set({ staff: s.staff.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="secondary" style={{ marginTop: 8 }} onClick={() => set({ staff: [...s.staff, ""] })}>
          担当者を追加
        </button>
      </section>

      <section className="panel">
        <h2>見積書番号の台帳（Googleスプレッドシート）</h2>
        <p className="muted">
          見積書番号は台帳の「番号だけ入っていて顧客名が空の行」を上から順に使い、
          その行に 顧客名／内容 を書き込みます（末尾に追記はしません）。
          番号は<strong>機種（提案）1件につき1つ</strong>消費します。
        </p>
        <div className="row">
          <Field label="台帳を使う" width={140}>
            <select
              value={s.quoteRegister.enabled ? "1" : "0"}
              onChange={(e) =>
                set({ quoteRegister: { ...s.quoteRegister, enabled: e.target.value === "1" } })
              }
            >
              <option value="1">使う</option>
              <option value="0">使わない</option>
            </select>
          </Field>
          <Field label="接続方式" width={260}>
            <select
              value={s.quoteRegister.mode}
              onChange={(e) =>
                set({
                  quoteRegister: {
                    ...s.quoteRegister,
                    mode: e.target.value as Settings["quoteRegister"]["mode"],
                  },
                })
              }
            >
              <option value="appsScript">Apps Script（設定が簡単・推奨）</option>
              <option value="serviceAccount">サービスアカウント鍵</option>
            </select>
          </Field>
          <Field label="シート名" width={140}>
            <input
              value={s.quoteRegister.sheetName}
              onChange={(e) => set({ quoteRegister: { ...s.quoteRegister, sheetName: e.target.value } })}
            />
          </Field>
          <Field label="開始番号（台帳が読めないとき）" width={220}>
            <input
              type="number"
              value={s.quoteRegister.startNumber}
              onChange={(e) =>
                set({ quoteRegister: { ...s.quoteRegister, startNumber: Number(e.target.value) } })
              }
            />
          </Field>
        </div>

        <div className="row" style={{ marginTop: 6 }}>
          <button className="secondary" onClick={testRegister}>
            台帳につながるか確認
          </button>
          {registerTest && (
            <span
              className={registerTest.startsWith("つながりました") ? "badge" : "warn"}
              style={{ alignSelf: "center" }}
            >
              {registerTest}
            </span>
          )}
        </div>

        {s.quoteRegister.mode === "appsScript" ? (
          <>
            <div className="row">
              <Field label="ウェブアプリのURL" width={460}>
                <input
                  value={s.quoteRegister.webAppUrl}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  onChange={(e) =>
                    set({ quoteRegister: { ...s.quoteRegister, webAppUrl: e.target.value.trim() } })
                  }
                />
              </Field>
              <Field label="合言葉（スクリプトのTOKEN）" width={240}>
                <input
                  type="password"
                  value={s.quoteRegister.webAppToken}
                  onChange={(e) =>
                    set({ quoteRegister: { ...s.quoteRegister, webAppToken: e.target.value } })
                  }
                />
              </Field>
            </div>
            <p className="muted">
              台帳のスプレッドシートで「拡張機能 →  Apps Script」を開き、
              <code>docs/apps-script/QuoteRegister.gs</code> の内容を貼り付けて
              「デプロイ → ウェブアプリ（実行：自分／アクセス：全員）」にすると、URLが表示されます。
              Google Cloud の設定は不要です。
            </p>
          </>
        ) : (
          <>
            <div className="row">
              <Field label="スプレッドシートID" width={420}>
                <input
                  value={s.quoteRegister.spreadsheetId}
                  placeholder="URLの /d/ と /edit の間"
                  onChange={(e) =>
                    set({ quoteRegister: { ...s.quoteRegister, spreadsheetId: e.target.value.trim() } })
                  }
                />
              </Field>
            </div>
            {serviceAccount.hasKey ? (
              <p className="muted">
                鍵ファイルを読み込みました。次のメールアドレスを、スプレッドシートの「共有」から
                <strong>編集者</strong>として追加してください。
                <br />
                <code style={{ userSelect: "all" }}>{serviceAccount.email}</code>{" "}
                <button
                  className="secondary"
                  onClick={() => {
                    if (serviceAccount.email) {
                      navigator.clipboard
                        .writeText(serviceAccount.email)
                        .then(() => setMessage("メールアドレスをコピーしました。"));
                    }
                  }}
                >
                  コピー
                </button>
              </p>
            ) : (
              <p className="warn">
                鍵ファイルが見つかりません。ダウンロードしたJSONを
                <code>google-service-account.json</code> という名前にして、
                データの保存先フォルダ（設定の保存先と同じ場所）に置いてください。
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <h2>案件の削除</h2>
        <p className="muted">
          案件一覧から削除するときは、担当者の選択とこのパスワードの入力が必要です。
          削除した案件は復旧用に <code>quotes-deleted</code> フォルダへ退避し、
          「誰がいつ何を削除したか」を削除履歴に残します。
        </p>
        <div className="row">
          <Field label="削除パスワード" width={260}>
            <input
              type="password"
              autoComplete="new-password"
              placeholder={s.deletionPasswordSet ? "設定済み（変更するときだけ入力）" : "未設定：入力して保存してください"}
              value={s.newDeletionPassword ?? ""}
              onChange={(e) => set({ newDeletionPassword: e.target.value })}
            />
          </Field>
          <div className="field" style={{ width: 200 }}>
            <label>状態</label>
            <span className={s.deletionPasswordSet ? "badge" : "warn"}>
              {s.deletionPasswordSet ? "設定済み" : "未設定（削除できません）"}
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <button onClick={save}>設定を保存</button>
        {message && <span className="badge" style={{ marginLeft: 12 }}>{message}</span>}
      </section>
    </>
  );
}

function Field({ label, width, children }: { label: string; width?: number; children: React.ReactNode }) {
  return (
    <div className="field" style={{ width }}>
      <label>{label}</label>
      {children}
    </div>
  );
}
