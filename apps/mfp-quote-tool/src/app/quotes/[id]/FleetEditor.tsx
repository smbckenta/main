"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FLEET,
  autoSelectProposals,
  calcFleet,
  copySide,
  deductionRateOf,
  emptyFleetUnit,
  fleetFromReadings,
  newChargeLine,
  proposalFromCurrent,
  requiredPpm,
  withDeductionRate,
} from "@/lib/fleet";
import { LEASE_TERMS, MAKERS, MAKER_LABELS } from "@/lib/types";
import type {
  ChargeTier,
  CounterReading,
  CurrentCalc,
  FleetPricing,
  FleetPricingCalc,
  Maker,
  PriceBook,
  PriceBookEntry,
  PricingMode,
  ProposalCalc,
  ServiceArea,
  Settings,
  CurrentChargeLine,
  DeviceSpec,
  Fleet,
  FleetSide,
  FleetUnit,
  Quote,
} from "@/lib/types";

/**
 * 複合機が複数台ある案件の入力。
 *
 * 台ごとに「現行」と「提案」を左右で入れ、そのままA3ヨコ1枚の
 * 複数台比較表として出す。1台だけの案件はこれまでどおり上の画面で作る。
 */

/** 保存や自動選定のあとにサーバーが返す、計算済みの案件 */
type ServerResult = {
  quote: Quote;
  current: CurrentCalc;
  proposals: ProposalCalc[];
  serviceArea?: ServiceArea;
};

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
  settings,
  machines,
  onChange,
  onServerResult,
}: {
  quote: Quote;
  settings: Settings;
  /** 直前の読み取りで明細から拾えた台（設置場所つき） */
  machines?: CounterReading[];
  onChange: (fleet: Fleet) => void;
  /** サーバーで組み立て直した案件を取り込む（機種の自動選定） */
  onServerResult: (json: ServerResult) => void;
}) {
  const taxRate = settings.company.taxRate;
  const fleet = quote.fleet ?? DEFAULT_FLEET;
  const calc = useMemo(() => calcFleet(fleet, taxRate, settings), [fleet, taxRate, settings]);

  // 提案機種を選ぶための機種DB。1回だけ読む
  const [devices, setDevices] = useState<DeviceSpec[]>([]);
  useEffect(() => {
    fetch("/api/devices")
      .then((r) => r.json())
      .then((d: DeviceSpec[]) => setDevices(Array.isArray(d) ? d : []))
      .catch(() => setDevices([]));
  }, []);

  // 機種の自動選定に使う仕切表
  const [book, setBook] = useState<PriceBook | null>(null);
  useEffect(() => {
    fetch("/api/pricebook")
      .then((r) => r.json())
      .then(setBook)
      .catch(() => setBook(null));
  }, []);
  const [autoMaker, setAutoMaker] = useState<Maker>("KYOCERA");
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoMessage, setAutoMessage] = useState("");
  const [autoError, setAutoError] = useState("");

  /** 明細から読み取った台を取り込む（手入力した提案側は残す） */
  function importMachines() {
    if (!machines?.length) return;
    onChange(fleetFromReadings(machines, fleet));
  }

  /**
   * 現行機の印刷速度を調べて入れる。
   *
   * 印刷速度は明細にも請求書にも載っていないので、型番からメーカーの
   * サイトを見るしかない。取得した仕様は機種DBに残るので、
   * 同じ機種は二度と取りに行かない。
   */
  async function fillSpecs(opts: { quiet?: boolean; forceRefresh?: boolean } = {}) {
    if (!opts.quiet) {
      setAutoBusy(true);
      setAutoError("");
      setAutoMessage("");
    }
    try {
      const res = await fetch(`/api/quotes/${quote.id}/fleet/specs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fleet, forceRefresh: opts.forceRefresh }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "印刷速度を調べられませんでした。");
      onServerResult(json as ServerResult);
      if (!opts.quiet) setAutoMessage((json.messages as string[] | undefined)?.join(" ") ?? "");
    } catch (err) {
      if (!opts.quiet) setAutoError((err as Error).message);
    } finally {
      if (!opts.quiet) setAutoBusy(false);
    }
  }

  /**
   * 印刷速度が空いている台があれば、画面を開いたときに1回だけ自動で調べる。
   * 取得した仕様は機種DBに残るので、2回目以降は動かない。
   */
  const triedSpecs = useRef("");
  useEffect(() => {
    const need = fleet.units.filter((u) => !u.current.ppm && (u.current.modelText ?? "").trim().length >= 3);
    if (!need.length) return;
    const key = need.map((u) => `${u.id}:${u.current.modelText}`).join("|");
    if (triedSpecs.current === key) return;
    triedSpecs.current = key;
    void fillSpecs({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet.units]);

  /**
   * 全台に提案機種を入れる。
   *
   * 現行機の印刷速度は明細に載っていないことが多いので、サーバー側で
   * 機種DB（無ければメーカーのサイト）から引いてから選ばせる。
   * 提案機種の筐体写真も同じところで用意し、機種DBに残す。
   */
  async function autoSelect() {
    setAutoBusy(true);
    setAutoError("");
    setAutoMessage("");
    try {
      const res = await fetch(`/api/quotes/${quote.id}/fleet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maker: autoMaker, fetchSpec: true, fleet }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "機種を選べませんでした。");
      onServerResult(json as ServerResult);
      setAutoMessage((json.messages as string[] | undefined)?.join(" ") ?? "");
    } catch (err) {
      // サーバーに行けない場合でも、手元の仕切表だけで選べるところまではやる
      if (book) {
        onChange(autoSelectProposals(fleet, autoMaker, book, settings));
        setAutoMessage("機種を入れました（現行機の速度は調べられなかったため、印刷枚数から判定しています）。");
      } else {
        setAutoError((err as Error).message);
      }
    } finally {
      setAutoBusy(false);
    }
  }

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
          削減シミュレーションは「単月・年間・リース年数ぶん」の3段で出します。
        </p>
        <div className="row">
          <button className="secondary" onClick={addUnit}>
            複数台比較表を使う（1台目を追加）
          </button>
          {machines && machines.length > 1 && (
            <button onClick={importMachines}>
              カウンター明細から{machines.length}台を取り込む
            </button>
          )}
        </div>
        {machines && machines.length > 1 && (
          <p className="muted" style={{ marginTop: 6 }}>
            読み取った設置場所：{machines.map((m) => m.location || m.modelText || m.serialNo).join(" / ")}
          </p>
        )}
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
        <label className="checks">
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={Boolean(fleet.leaseUnknown)}
              onChange={(e) => patch({ leaseUnknown: e.target.checked })}
            />
            現行のリース料金が不明（カウンター料金のみで比較する）
          </span>
        </label>
        <div className="field" style={{ width: 170 }}>
          <label>リース年数</label>
          <select
            value={fleet.leaseTerm}
            onChange={(e) => patch({ leaseTerm: Number(e.target.value) })}
          >
            {LEASE_TERMS.map((t) => (
              <option key={t} value={t}>
                {Math.round(t / 12)}年（{t}回）
              </option>
            ))}
          </select>
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
                <label>
                  No.{u.no}　設置場所
                  {unit.serialNo && <span className="muted">（機番 {unit.serialNo}）</span>}
                </label>
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

            <div className="fleet-sides" style={{ marginTop: 10 }}>
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
                devices={devices}
                book={book}
                settings={settings}
                leaseTerm={fleet.leaseTerm}
                pricingCalc={u.proposal.pricing}
                requiredPpm={requiredPpm(unit, settings)}
                // 提案の枚数は現行と同じ（控除前）。画面でも計算後の値を出す
                pagesFrom={u.proposal.lines.map((l) => l.pages)}
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
        {fleet.units.length > 0 && (
          <>
            <select value={autoMaker} onChange={(e) => setAutoMaker(e.target.value as Maker)} style={{ width: 150 }}>
              {MAKERS.filter((m) => m !== "OTHER").map((m) => (
                <option key={m} value={m}>
                  {MAKER_LABELS[m]}
                </option>
              ))}
            </select>
            <button
              className="secondary"
              onClick={() => void fillSpecs({ forceRefresh: true })}
              disabled={autoBusy}
              title="現行機の型番から印刷速度をメーカーのサイトで調べ、機種DBに保存します。すでに取得済みの機種は保存済みの値を使います。"
            >
              現行機の印刷速度を取得
            </button>
            <button
              onClick={() => void autoSelect()}
              disabled={autoBusy}
              title="台ごとに、現行と同等以上の印刷速度の機種を仕切表から選びます。全台の合計枚数から1台を選ぶのではなく、設置場所ごとに1台ずつ出します。提案機種の写真も機種DBに用意します。"
            >
              {autoBusy ? "選定中…" : `全${fleet.units.length}台に機種を自動選定`}
            </button>
          </>
        )}
        {machines && machines.length > 0 && (
          <button className="secondary" onClick={importMachines} title="明細に載っている複合機を、設置場所つきで台に取り込みます。すでにある台は現行側だけ差し替え、提案側の入力は残します。">
            カウンター明細から{machines.length}台を取り込む
          </button>
        )}
      </div>
      {machines && machines.length > 0 && (
        <p className="muted" style={{ marginTop: 4 }}>
          明細から読み取った設置場所：{machines.map((m) => m.location || m.modelText || m.serialNo).join(" / ")}
        </p>
      )}
      {autoBusy && <p className="spinner">機種を選んでいます… 現行機の速度と提案機種の写真を調べるため、少し時間がかかります。</p>}
      {autoMessage && <p className="badge">{autoMessage}</p>}
      {autoError && <p className="error">{autoError}</p>}

      {fleet.leaseUnknown && (
        <p className="warn" style={{ marginTop: 10 }}>
          現行のリース料金が不明なため、<b>カウンター料金だけで比較</b>します。
          比較表からリース料金の内訳ブロックを外し、合計もカウンター料金だけになります。
        </p>
      )}

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
                <th>リース料金 合計（税込）{fleet.leaseUnknown ? "※比較に含めません" : ""}</th>
                <td className="num">{fleet.leaseUnknown ? "－（不明）" : yen(calc.current.leaseTotal)}</td>
                <td className="num">{yen(calc.proposal.leaseTotal)}</td>
                <td className="num">
                  {fleet.leaseUnknown ? "－" : sign(calc.proposal.leaseTotal - calc.current.leaseTotal)}
                </td>
              </tr>
              <tr>
                <th>カウンター料金 小計（税込）</th>
                <td className="num">{yen(calc.current.counterSubtotal)}</td>
                <td className="num">{yen(calc.proposal.counterSubtotal)}</td>
                <td className="num">{sign(calc.proposal.counterSubtotal - calc.current.counterSubtotal)}</td>
              </tr>
              <tr>
                <th>{fleet.leaseUnknown ? "カウンター料金" : "合計金額"}（単月）</th>
                <td className="num">{yen(calc.current.monthly)}</td>
                <td className="num">{yen(calc.proposal.monthly)}</td>
                <td className={`num ${calc.diffMonthly < 0 ? "save" : "cut"}`}>{sign(calc.diffMonthly)}</td>
              </tr>
              <tr>
                <th>{fleet.leaseUnknown ? "カウンター料金" : "合計金額"}（年間）</th>
                <td className="num">{yen(calc.current.yearly)}</td>
                <td className="num">{yen(calc.proposal.yearly)}</td>
                <td className={`num ${calc.diffYearly < 0 ? "save" : "cut"}`}>{sign(calc.diffYearly)}</td>
              </tr>
              <tr>
                <th>{fleet.leaseUnknown ? "カウンター料金" : "合計金額"}（{calc.leaseYears}年間）</th>
                <td className="num">{yen(calc.current.longTerm)}</td>
                <td className="num">{yen(calc.proposal.longTerm)}</td>
                <td className={`num ${calc.diffMonthly < 0 ? "save" : "cut"}`}>
                  {sign(calc.diffLeaseTerm)}
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
  devices,
  book,
  settings,
  leaseTerm,
  pricingCalc,
  requiredPpm: needPpm,
  pagesFrom,
  onChange,
}: {
  title: string;
  side: FleetSide;
  deductionRate: number;
  billed: number;
  allowDeduction?: boolean;
  /** 提案側で選べる機種（機種DB） */
  devices?: DeviceSpec[];
  /** 仕切表（提案側の機種と仕切価格を選ぶ） */
  book?: PriceBook | null;
  settings?: Settings;
  leaseTerm?: number;
  /** リース料の決め方から出した金額（提案側） */
  pricingCalc?: FleetPricingCalc;
  /** この台に要る印刷速度（現行と同等以上） */
  requiredPpm?: number;
  /** 計算後の印刷枚数（提案側は現行と同じ枚数になる） */
  pagesFrom?: number[];
  onChange: (patch: Partial<FleetSide>) => void;
}) {
  const isProposal = !allowDeduction;
  const patchLine = (i: number, p: Partial<CurrentChargeLine>) =>
    onChange({ lines: side.lines.map((l, x) => (x === i ? { ...l, ...p } : l)) });
  const patchTier = (i: number, t: number, p: Partial<ChargeTier>) =>
    patchLine(i, { tiers: side.lines[i].tiers.map((tier, x) => (x === t ? { ...tier, ...p } : tier)) });

  /**
   * 提案側は台ごとにメーカーを選べる。
   * 選んだメーカーの機種だけを型番の候補に出す（台数が多いと選び間違えるため）。
   */
  const maker = MAKERS.find((m) => MAKER_LABELS[m] === side.makerText.trim());
  const candidates = (devices ?? []).filter((d) => !maker || d.maker === maker);
  const listId = `fleet-models-${maker ?? "all"}`;

  /** 機種DBから選んだら、型番と印刷速度をまとめて入れる */
  function pickModel(model: string) {
    const found = (devices ?? []).find((d) => d.model === model);
    onChange({
      modelText: model,
      ...(found
        ? {
            makerText: found.makerText || MAKER_LABELS[found.maker],
            ppm: found.ppmColor ?? found.ppmMono ?? side.ppm,
          }
        : {}),
    });
  }

  return (
    <div className={`fleet-side ${isProposal ? "proposal" : "current"}`}>
      <strong className="fleet-side-title">{title}</strong>
      <div className="row">
        <div className="field" style={{ width: 140 }}>
          <label>メーカー</label>
          {isProposal ? (
            <select
              value={maker ?? ""}
              onChange={(e) =>
                onChange({ makerText: e.target.value ? MAKER_LABELS[e.target.value as (typeof MAKERS)[number]] : "" })
              }
            >
              <option value="">（選択してください）</option>
              {MAKERS.map((m) => (
                <option key={m} value={m}>
                  {MAKER_LABELS[m]}
                </option>
              ))}
            </select>
          ) : (
            <input value={side.makerText} onChange={(e) => onChange({ makerText: e.target.value })} />
          )}
        </div>
        <div className="field" style={{ flex: 1, minWidth: 170 }}>
          <label>{isProposal ? "提案機種" : "物件名（型番）"}</label>
          {isProposal ? (
            <>
              <input
                list={listId}
                value={side.modelText}
                placeholder="型番を入力、または一覧から選ぶ"
                onChange={(e) => pickModel(e.target.value)}
              />
              <datalist id={listId}>
                {candidates.map((d) => (
                  <option key={d.id} value={d.model}>
                    {MAKER_LABELS[d.maker]}
                  </option>
                ))}
              </datalist>
            </>
          ) : (
            <input value={side.modelText} onChange={(e) => onChange({ modelText: e.target.value })} />
          )}
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
          {isProposal && side.pricing ? (
            <input readOnly value={yen(pricingCalc?.monthlyLease ?? 0)} title="下の「価格の決め方」から計算しています" />
          ) : (
            <input
              type="number"
              value={side.monthlyLease}
              onChange={(e) => onChange({ monthlyLease: Number(e.target.value) || 0 })}
            />
          )}
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

      {isProposal && settings && (
        <PricingEditor
          pricing={side.pricing}
          calc={pricingCalc}
          book={book}
          settings={settings}
          leaseTerm={leaseTerm ?? 72}
          requiredPpm={needPpm}
          onChange={(pricing) => onChange({ pricing })}
          onPickEntry={(entry) =>
            onChange({
              modelText: entry.model,
              makerText: MAKER_LABELS[entry.maker],
              ppm: entry.gradePpm,
              pricing: {
                mode: side.pricing?.mode ?? "fromGp",
                ...side.pricing,
                priceBookId: entry.id,
                cost: entry.cost,
              },
            })
          }
        />
      )}

      <div className="fleet-lines">
      <table>
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
                {isProposal ? (
                  // 提案の枚数は現行と同じ（現行に控除があっても控除前の枚数）。
                  // ここで別の枚数を入れられると、比べている前提が崩れてしまう
                  <input
                    readOnly
                    style={{ width: 90, textAlign: "right" }}
                    value={(pagesFrom?.[i] ?? l.pages).toLocaleString()}
                    title="現状利用状況と同じ枚数です（現行に控除がある場合も控除前の枚数）"
                  />
                ) : (
                  <input
                    type="number"
                    style={{ width: 90 }}
                    value={l.pages}
                    onChange={(e) => patchLine(i, { pages: Number(e.target.value) || 0 })}
                  />
                )}
              </td>
              <td>
                {l.tiers.map((t, x) => (
                  <div key={x} className="fleet-tier">
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
      </div>
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

const PRICING_MODES: { value: PricingMode; label: string }[] = [
  { value: "fromGp", label: "仕切＋GP（粗利額）" },
  { value: "fromMargin", label: "仕切＋粗利率" },
  { value: "fromPrice", label: "本体価格を直接入力" },
  { value: "fromLease", label: "目標の月額リース料から逆算" },
];

/**
 * 提案する1台の価格の決め方。
 *
 * 1台だけの案件と同じ4通りから選べる。どれで決めても最後は本体価格に
 * 揃うので、下に「仕切／本体価格／販売額計／GP／月額リース料」を並べて
 * 何がどう効いたのかが分かるようにしている。
 */
function PricingEditor({
  pricing,
  calc,
  book,
  settings,
  leaseTerm,
  requiredPpm: needPpm,
  onChange,
  onPickEntry,
}: {
  pricing?: FleetPricing;
  calc?: FleetPricingCalc;
  book?: PriceBook | null;
  settings: Settings;
  leaseTerm: number;
  requiredPpm?: number;
  onChange: (pricing: FleetPricing | undefined) => void;
  onPickEntry: (entry: PriceBookEntry) => void;
}) {
  if (!pricing) {
    return (
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="secondary"
          onClick={() =>
            onChange({
              mode: "fromGp",
              grossProfitAmount: settings.defaultGrossProfit,
              marginRate: settings.defaultMarginRate,
            })
          }
        >
          仕切＋GPからリース料を計算する
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          使わない場合は、上の「月額リース料」に直接入力してください。
        </span>
      </div>
    );
  }

  const patch = (p: Partial<FleetPricing>) => onChange({ ...pricing, ...p });
  const num = (v: string) => (v === "" ? undefined : Number(v));
  // 現行と同等以上の速度のものだけを候補に出す（下位機種を誤って選ばないように）
  const entries = (book?.entries ?? []).filter((e) => !needPpm || e.gradePpm >= needPpm);

  return (
    <div style={{ marginTop: 8, padding: "8px 10px", background: "#f7fafc", borderRadius: 6 }}>
      <div className="row">
        <div className="field" style={{ width: 200 }}>
          <label>価格の決め方</label>
          <select value={pricing.mode} onChange={(e) => patch({ mode: e.target.value as PricingMode })}>
            {PRICING_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 190 }}>
          <label>
            仕切表から選ぶ
            {needPpm ? <span className="muted">（{needPpm}枚機以上）</span> : null}
          </label>
          <select
            value={pricing.priceBookId ?? ""}
            onChange={(e) => {
              const entry = entries.find((x) => x.id === e.target.value);
              if (entry) onPickEntry(entry);
            }}
          >
            <option value="">（選択してください）</option>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {MAKER_LABELS[e.maker]} {e.model}（{e.gradePpm}枚機）
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>仕切価格</label>
          <input
            type="number"
            value={pricing.cost ?? ""}
            onChange={(e) => patch({ cost: num(e.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        {pricing.mode === "fromGp" && (
          <div className="field" style={{ width: 130 }}>
            <label>GP（粗利額）</label>
            <input
              type="number"
              value={pricing.grossProfitAmount ?? ""}
              onChange={(e) => patch({ grossProfitAmount: num(e.target.value) })}
            />
          </div>
        )}
        {pricing.mode === "fromMargin" && (
          <div className="field" style={{ width: 110 }}>
            <label>粗利率（%）</label>
            <input
              type="number"
              step={1}
              value={pricing.marginRate === undefined ? "" : Math.round(pricing.marginRate * 1000) / 10}
              onChange={(e) => patch({ marginRate: e.target.value === "" ? undefined : Number(e.target.value) / 100 })}
            />
          </div>
        )}
        {pricing.mode === "fromPrice" && (
          <div className="field" style={{ width: 130 }}>
            <label>本体価格</label>
            <input
              type="number"
              value={pricing.bodyPrice ?? ""}
              onChange={(e) => patch({ bodyPrice: num(e.target.value) })}
            />
          </div>
        )}
        {pricing.mode === "fromLease" && (
          <div className="field" style={{ width: 150 }}>
            <label>目標の月額リース料</label>
            <input
              type="number"
              value={pricing.targetMonthlyLease ?? ""}
              onChange={(e) => patch({ targetMonthlyLease: num(e.target.value) })}
            />
          </div>
        )}
        <div className="field" style={{ width: 130 }}>
          <label>オプション上乗せ</label>
          <input
            type="number"
            value={pricing.addOnTotal ?? ""}
            onChange={(e) => patch({ addOnTotal: num(e.target.value) })}
          />
        </div>
        <button className="secondary" style={{ alignSelf: "flex-end" }} onClick={() => onChange(undefined)}>
          決め方を使わない
        </button>
      </div>

      {calc && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          本体価格 {yen(calc.bodyPrice)}
          {calc.addOnTotal > 0 && ` ＋ 上乗せ ${yen(calc.addOnTotal)}`} ＝ 販売額計 {yen(calc.sellingTotal)}
          {" ／ "}GP {yen(calc.grossProfit)}（{(calc.marginRate * 100).toFixed(1)}%）
          {" ／ "}リース料率 {(calc.leaseRate * 100).toFixed(3)}%（{Math.round(leaseTerm / 12)}年）
          {" → "}
          <b>月額 {yen(calc.monthlyLease)}</b>
        </div>
      )}
    </div>
  );
}
