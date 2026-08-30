"use client";

import { useEffect, useState } from "react";
import { MAKERS, MAKER_LABELS } from "@/lib/types";
import type { DeviceSpec, Maker } from "@/lib/types";

const empty: DeviceSpec = {
  id: "",
  maker: "KYOCERA",
  model: "",
  source: { method: "manual" },
  updatedAt: "",
};

/** 機種スペックDB（比較表に使う項目の管理） */
export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceSpec[]>([]);
  const [draft, setDraft] = useState<DeviceSpec>(empty);
  const [lookupModel, setLookupModel] = useState("");
  const [lookupMaker, setLookupMaker] = useState<Maker>("KYOCERA");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    setDevices(await (await fetch("/api/devices")).json());
  }
  useEffect(() => {
    reload();
  }, []);

  async function save(device: DeviceSpec) {
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...device, source: device.source ?? { method: "manual" } }),
    });
    if (res.ok) {
      await reload();
      setDraft(empty);
      setMessage(`${device.model} を保存しました。`);
    } else setError((await res.json()).error ?? "保存に失敗しました。");
  }

  async function remove(id: string) {
    if (!confirm("この機種を削除しますか？")) return;
    await fetch(`/api/devices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await reload();
  }

  async function lookup() {
    if (!lookupModel) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/devices/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: lookupModel, maker: lookupMaker, forceRefresh: true }),
      });
      const json = await res.json();
      if (json.device) {
        await reload();
        setMessage(
          json.origin === "web"
            ? `インターネットから取得してDBに登録しました（${json.url}）。内容を確認してください。`
            : "機種DBに既に登録済みです。",
        );
      } else {
        setError(json.message ?? "取得できませんでした。");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="panel">
        <h2>インターネットからスペックを取得</h2>
        <p className="muted">
          取得したスペックはDBに保存され、次回以降はインターネットに出ずに使われます（DBを少しずつ育てる運用）。
        </p>
        <div className="row">
          <div className="field" style={{ width: 160 }}>
            <label>メーカー</label>
            <select value={lookupMaker} onChange={(e) => setLookupMaker(e.target.value as Maker)}>
              {MAKERS.map((m) => (
                <option key={m} value={m}>
                  {MAKER_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 260 }}>
            <label>型番</label>
            <input value={lookupModel} onChange={(e) => setLookupModel(e.target.value)} placeholder="TASKalfa MZ3501ci" />
          </div>
          <button onClick={lookup} disabled={busy || !lookupModel}>
            {busy ? "取得中…" : "取得する"}
          </button>
        </div>
        {message && <p className="warn" style={{ marginTop: 10 }}>{message}</p>}
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      </section>

      <section className="panel">
        <h2>機種スペックDB（{devices.length}件）</h2>
        <table>
          <thead>
            <tr>
              <th>メーカー</th>
              <th>機種</th>
              <th className="num">ウォームアップ</th>
              <th className="num">FC（モノ）</th>
              <th className="num">FC（カラー）</th>
              <th className="num">速度（モノ）</th>
              <th className="num">速度（カラー）</th>
              <th>取得元</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.makerText ?? MAKER_LABELS[d.maker]}</td>
                <td>{d.model}</td>
                <td className="num">{d.warmupSec ?? "－"}</td>
                <td className="num">{d.firstCopyMonoSec ?? "－"}</td>
                <td className="num">{d.firstCopyColorSec ?? "－"}</td>
                <td className="num">{d.ppmMono ?? "－"}</td>
                <td className="num">{d.ppmColor ?? "－"}</td>
                <td>
                  {d.source.method === "web" && d.source.url ? (
                    <a href={d.source.url} target="_blank" rel="noreferrer">
                      web
                    </a>
                  ) : (
                    d.source.method
                  )}
                </td>
                <td>
                  <button className="secondary" onClick={() => setDraft(d)}>
                    編集
                  </button>{" "}
                  <button className="danger" onClick={() => remove(d.id)}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>{draft.id ? "スペックの編集" : "スペックの手入力"}</h2>
        <div className="row">
          <div className="field" style={{ width: 160 }}>
            <label>メーカー</label>
            <select value={draft.maker} onChange={(e) => setDraft({ ...draft, maker: e.target.value as Maker })}>
              {MAKERS.map((m) => (
                <option key={m} value={m}>
                  {MAKER_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 200 }}>
            <label>メーカー表記（比較表用）</label>
            <input value={draft.makerText ?? ""} onChange={(e) => setDraft({ ...draft, makerText: e.target.value })} />
          </div>
          <div className="field" style={{ width: 220 }}>
            <label>型番</label>
            <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          </div>
          {(
            [
              ["warmupSec", "ウォームアップ(秒)"],
              ["firstCopyMonoSec", "FC モノクロ(秒)"],
              ["firstCopyColorSec", "FC カラー(秒)"],
              ["ppmMono", "速度 モノクロ(枚/分)"],
              ["ppmColor", "速度 カラー(枚/分)"],
            ] as const
          ).map(([key, label]) => (
            <div className="field" style={{ width: 140 }} key={key}>
              <label>{label}</label>
              <input
                type="number"
                step="0.1"
                value={draft[key] ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </div>
          ))}
          <button onClick={() => save(draft)} disabled={!draft.model}>
            保存
          </button>
          <button className="secondary" onClick={() => setDraft(empty)}>
            クリア
          </button>
        </div>
      </section>
    </>
  );
}
