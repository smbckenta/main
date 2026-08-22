"use client";

import { useMemo } from "react";
import {
  DEFAULT_FLEET,
  calcFleet,
  copySide,
  deductionRateOf,
  emptyFleetUnit,
  newChargeLine,
  proposalFromCurrent,
  withDeductionRate,
} from "@/lib/fleet";
import type { ChargeTier, CurrentChargeLine, Fleet, FleetSide, FleetUnit, Quote } from "@/lib/types";

/**
 * 複合機が複数台ある案件の入力。
 *
 * 台ごとに「現行」と「提案」を左右で入れ、そのままA3ヨコ1枚の
 * 複数台比較表として出す。1台だけの案件はこれまでどおり上の画面で作る。
 */

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const sign = (n: number) =>
  n === 0 ? "±0" : n < 0 ? `▲${Math.abs(Math.round(n)).toLocaleString()}` : `+${Math.round(n).toLocaleString()}`;

const KINDS: { value: CurrentChargeLine["kind"]; label: string }[] = [
  { value: "mono", label: "モノクロ" },
  { value: "color", label: "カラー" },
  { value: "twoColor", label: "2色カラー" },
  { value: "other", label: "その他" },
];

export default function FleetEditor({
  quote,
  taxRate,
  onChange,
}: {
  quote: Quote;
  taxRate: number;
  onChange: (fleet: Fleet) => void;
}) {
  const fleet = quote.fleet ?? DEFAULT_FLEET;
  const calc = useMemo(() => calcFleet(fleet, taxRate), [fleet, taxRate]);

  const patch = (p: Partial<Fleet>) => onChange({ ...fleet, ...p });
  const patchUnit = (id: string, p: Partial<FleetUnit>) =>
    patch({ units: fleet.units.map((u) => (u.id === id ? { ...u, ...p } : u)) });
  const patchSide = (id: string, which: "current" | "proposal", p: Partial<FleetSide>) =>
    patch({
      units: fleet.units.map((u) => (u.id === id ? { ...u, [which]: { ...u[which], ...p } } : u)),
    });

  function addUnit() {
    const unit = emptyFleetUnit(`u${Date.now().toString(36)}${fleet.units.length}`);
    // 1台目は上で入力した現行機の内容をたたき台にする
    if (!fleet.units.length && quote.current.modelText) {
      unit.current = {
        makerText: quote.current.makerText,
        modelText: quote.current.modelText,
        monthlyLease: quote.current.monthlyLease,
        minCharge: quote.current.units.minCharge,
        maintenanceMonthly: quote.current.maintenanceMonthly,
        lines: quote.current.chargeLines?.length
          ? quote.current.chargeLines.map((l) => ({ ...l, tiers: l.tiers.map((t) => ({ ...t })) }))
          : [
              { ...newChargeLine("モノクロ", "mono"), pages: quote.current.monoPages, tiers: [{ from: 1, to: null, unit: quote.current.units.mono }] },
              { ...newChargeLine("カラー", "color"), pages: quote.current.colorPages, tiers: [{ from: 1, to: null, unit: quote.current.units.color }] },
            ].map((l) => ({ ...l, deductionRate: quote.current.deductionRate })),
      };
      unit.proposal = proposalFromCurrent(unit.current);
    }
    patch({ enabled: true, units: [...fleet.units, unit] });
  }

  if (!fleet.enabled && !fleet.units.length) {
    return (
      <section className="panel">
        <h2>複数台の比較（A3ヨコ 複数台比較表）</h2>
        <p className="muted">
          複合機が複数台ある案件では、台数ぶんを1枚にまとめたA3ヨコの比較表を使います。
          設置場所ごとに現行機と提案機を並べ、リース料金とカウンター料金を台数ぶん合計して比べます。
        </p>
        <button className="secondary" onClick={addUnit}>
          複数台比較表を使う（1台目を追加）
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>複数台の比較（A3ヨコ 複数台比較表）</h2>
      <div className="row">
        <label className="checks">
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={fleet.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            この案件は複数台（A3ヨコの複数台比較表を出す）
          </span>
        </label>
        <div className="field" style={{ width: 220 }}>
          <label>印刷枚数の集計期間（見出しの括弧書き）</label>
          <input
            value={fleet.pagesNote ?? ""}
            placeholder="2025年-2026年印刷枚数"
            onChange={(e) => patch({ pagesNote: e.target.value })}
          />
        </div>
        <div className="field" style={{ width: 130 }}>
          <label>合計金額の年数</label>
          <input
            type="number"
            value={fleet.totalYears}
            onChange={(e) => patch({ totalYears: Number(e.target.value) || 6 })}
          />
        </div>
        <div className="field" style={{ width: 130 }}>
          <label>削減効果の年数</label>
          <input
            type="number"
            value={fleet.effectYears}
            onChange={(e) => patch({ effectYears: Number(e.target.value) || 7 })}
          />
        </div>
      </div>

      {calc.units.map((u) => {
        const unit = u.unit;
        const currentDeduction = deductionRateOf(unit.current);
        const proposalDeduction = deductionRateOf(unit.proposal);
        return (
          <div key={unit.id} className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="field" style={{ flex: 1, minWidth: 280 }}>
                <label>No.{u.no}　設置場所</label>
                <input
                  value={unit.location}
                  placeholder="○○支店（2階事務所）"
                  onChange={(e) => patchUnit(unit.id, { location: e.target.value })}
                />
              </div>
              <div className="row">
                <button
                  className="secondary"
                  title="現行機の内容を提案側に写します。現行の控除は当社の提案には無いので外します。"
                  onClick={() => patchUnit(unit.id, { proposal: proposalFromCurrent(unit.current) })}
                >
                  現行を提案に写す（控除は外す）
                </button>
                <button
                  className="secondary"
                  title="この台は入替せず、現行のまま据え置きます（控除もそのまま）。"
                  onClick={() => patchUnit(unit.id, { proposal: copySide(unit.current) })}
                >
                  据え置く
                </button>
                <button
                  className="secondary"
                  onClick={() => patch({ units: fleet.units.filter((x) => x.id !== unit.id) })}
                >
                  この台を削除
                </button>
              </div>
            </div>

            <div className="grid2" style={{ marginTop: 10 }}>
              <SideEditor
                title="現状利用状況"
                side={unit.current}
                deductionRate={currentDeduction}
                billed={u.current.counterTotal}
                allowDeduction
                onChange={(p) => patchSide(unit.id, "current", p)}
              />
              <SideEditor
                title="導入提案予測"
                side={unit.proposal}
                deductionRate={proposalDeduction}
                billed={u.proposal.counterTotal}
                onChange={(p) => patchSide(unit.id, "proposal", p)}
              />
            </div>

            {currentDeduction > 0 && proposalDeduction === 0 && (
              <p className="muted" style={{ marginTop: 8 }}>
                現行は控除{Math.round(currentDeduction * 1000) / 10}%（▲
                {u.current.deductedPages.toLocaleString()}枚）を差し引いた枚数で、提案は実枚数で計算しています。
                比較表にもその旨を注記します。
              </p>
            )}
            {proposalDeduction > 0 && (
              <p className="warn" style={{ marginTop: 8 }}>
                提案側に控除{Math.round(proposalDeduction * 1000) / 10}%が入っています。
                当社の提案には通常控除がありません。この台を据え置く場合を除き、提案側の控除は0にしてください。
              </p>
            )}
          </div>
        );
      })}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="secondary" onClick={addUnit}>
          台を追加
        </button>
      </div>

      {calc.units.length > 0 && (
        <>
          <h3>合計</h3>
          <table style={{ maxWidth: 720 }}>
            <thead>
              <tr>
                <th></th>
                <th className="num">現状利用状況</th>
                <th className="num">導入提案予測</th>
                <th className="num">削減額</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>リース料金 合計（税込）</th>
                <td className="num">{yen(calc.current.leaseTotal)}</td>
                <td className="num">{yen(calc.proposal.leaseTotal)}</td>
                <td className="num">{sign(calc.proposal.leaseTotal - calc.current.leaseTotal)}</td>
              </tr>
              <tr>
                <th>カウンター料金 小計（税込）</th>
                <td className="num">{yen(calc.current.counterSubtotal)}</td>
                <td className="num">{yen(calc.proposal.counterSubtotal)}</td>
                <td className="num">{sign(calc.proposal.counterSubtotal - calc.current.counterSubtotal)}</td>
              </tr>
              <tr>
                <th>合計金額（単月）</th>
                <td className="num">{yen(calc.current.monthly)}</td>
                <td className="num">{yen(calc.proposal.monthly)}</td>
                <td className={`num ${calc.diffMonthly < 0 ? "save" : "cut"}`}>{sign(calc.diffMonthly)}</td>
              </tr>
              <tr>
                <th>合計金額（年間）</th>
                <td className="num">{yen(calc.current.yearly)}</td>
                <td className="num">{yen(calc.proposal.yearly)}</td>
                <td className={`num ${calc.diffYearly < 0 ? "save" : "cut"}`}>{sign(calc.diffYearly)}</td>
              </tr>
              <tr>
                <th>合計金額（{calc.totalYears}年間）</th>
                <td className="num">{yen(calc.current.longTerm)}</td>
                <td className="num">{yen(calc.proposal.longTerm)}</td>
                <td className={`num ${calc.diffMonthly < 0 ? "save" : "cut"}`}>
                  {sign(calc.diffMonthly * 12 * calc.totalYears)}
                </td>
              </tr>
              <tr>
                <th>削減率</th>
                <td className="num" colSpan={2}></td>
                <td className={`num ${calc.reductionRate < 0 ? "save" : "cut"}`}>
                  {(Math.abs(calc.reductionRate) * 100).toFixed(1)}%
                  {calc.reductionRate < 0 ? " 削減" : calc.reductionRate > 0 ? " 増加" : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** 1台の片側（現行 or 提案）の入力 */
function SideEditor({
  title,
  side,
  deductionRate,
  billed,
  allowDeduction,
  onChange,
}: {
  title: string;
  side: FleetSide;
  deductionRate: number;
  billed: number;
  allowDeduction?: boolean;
  onChange: (patch: Partial<FleetSide>) => void;
}) {
  const patchLine = (i: number, p: Partial<CurrentChargeLine>) =>
    onChange({ lines: side.lines.map((l, x) => (x === i ? { ...l, ...p } : l)) });
  const patchTier = (i: number, t: number, p: Partial<ChargeTier>) =>
    patchLine(i, { tiers: side.lines[i].tiers.map((tier, x) => (x === t ? { ...tier, ...p } : tier)) });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
      <strong style={{ fontSize: 13 }}>{title}</strong>
      <div className="row" style={{ marginTop: 6 }}>
        <div className="field" style={{ width: 110 }}>
          <label>メーカー</label>
          <input value={side.makerText} onChange={(e) => onChange({ makerText: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 150 }}>
          <label>{title === "現状利用状況" ? "物件名（型番）" : "提案機種"}</label>
          <input value={side.modelText} onChange={(e) => onChange({ modelText: e.target.value })} />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>印刷速度</label>
          <input
            type="number"
            value={side.ppm ?? ""}
            onChange={(e) => onChange({ ppm: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ width: 120 }}>
          <label>月額リース料</label>
          <input
            type="number"
            value={side.monthlyLease}
            onChange={(e) => onChange({ monthlyLease: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>最低基本料金</label>
          <input
            type="number"
            value={side.minCharge}
            onChange={(e) => onChange({ minCharge: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>月額保守料金</label>
          <input
            type="number"
            value={side.maintenanceMonthly}
            onChange={(e) => onChange({ maintenanceMonthly: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>控除（%）{allowDeduction ? "" : "※提案は0"}</label>
          <input
            type="number"
            step={0.5}
            value={Math.round(deductionRate * 1000) / 10}
            onChange={(e) => {
              const next = { ...side, lines: side.lines };
              onChange(withDeductionRate(next, (Number(e.target.value) || 0) / 100));
            }}
          />
        </div>
      </div>
      {title === "現状利用状況" && (
        <div className="field" style={{ width: "100%" }}>
          <label>備考</label>
          <input
            value={side.note ?? ""}
            placeholder="A3モノクロ複合機／レンタル など"
            onChange={(e) => onChange({ note: e.target.value })}
          />
        </div>
      )}

      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>項目</th>
            <th>種別</th>
            <th className="num">印刷枚数</th>
            <th>チャージ枚数と単価</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {side.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <input
                  style={{ width: 100 }}
                  value={l.name}
                  onChange={(e) => patchLine(i, { name: e.target.value })}
                />
              </td>
              <td>
                <select value={l.kind} onChange={(e) => patchLine(i, { kind: e.target.value as CurrentChargeLine["kind"] })}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="num">
                <input
                  type="number"
                  style={{ width: 90 }}
                  value={l.pages}
                  onChange={(e) => patchLine(i, { pages: Number(e.target.value) || 0 })}
                />
              </td>
              <td>
                {l.tiers.map((t, x) => (
                  <div key={x} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3 }}>
                    <input
                      type="number"
                      style={{ width: 70 }}
                      value={t.from}
                      onChange={(e) => patchTier(i, x, { from: Number(e.target.value) || 1 })}
                    />
                    <span>〜</span>
                    <input
                      type="number"
                      style={{ width: 70 }}
                      placeholder="上限なし"
                      value={t.to ?? ""}
                      onChange={(e) => patchTier(i, x, { to: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <span>枚</span>
                    <input
                      type="number"
                      step={0.01}
                      style={{ width: 70 }}
                      value={t.unit}
                      onChange={(e) => patchTier(i, x, { unit: Number(e.target.value) || 0 })}
                    />
                    <span>円</span>
                    {l.tiers.length > 1 && (
                      <button
                        className="secondary"
                        style={{ padding: "2px 6px" }}
                        onClick={() => patchLine(i, { tiers: l.tiers.filter((_, y) => y !== x) })}
                      >
                        －
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="secondary"
                  style={{ padding: "2px 8px" }}
                  onClick={() =>
                    patchLine(i, {
                      tiers: [
                        ...l.tiers,
                        { from: (l.tiers[l.tiers.length - 1]?.to ?? 0) + 1, to: null, unit: 0 },
                      ],
                    })
                  }
                >
                  段を追加
                </button>
              </td>
              <td>
                <button
                  className="secondary"
                  style={{ padding: "2px 8px" }}
                  onClick={() => onChange({ lines: side.lines.filter((_, x) => x !== i) })}
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
        <div className="row">
          <button
            className="secondary"
            style={{ padding: "3px 10px" }}
            onClick={() => onChange({ lines: [...side.lines, newChargeLine("モノクロ", "mono")] })}
          >
            モノクロを追加
          </button>
          <button
            className="secondary"
            style={{ padding: "3px 10px" }}
            onClick={() => onChange({ lines: [...side.lines, newChargeLine("カラー", "color")] })}
          >
            カラーを追加
          </button>
        </div>
        <div className="muted">請求金額（税込）：{yen(billed)}</div>
      </div>
    </div>
  );
}
