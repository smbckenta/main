"use client";

import { useState } from "react";
import { emptyOption, optionMonthlyLease } from "@/lib/proposal-doc";
import { MAKER_LABELS } from "@/lib/types";
import type { DeviceOption, DeviceSpec, ProposalCalc, Quote, Settings } from "@/lib/types";

/**
 * 提案資料（写真入りのご提案書）の入力。
 *
 * 写真とオプションは機種DBに持たせる（同じ機種を次の案件で提案するときに使い回せる）。
 * 表紙の文言・現状の課題・訴求ポイントは案件ごとに持つ。
 */

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

/** 改行区切りのテキストと配列を行き来する（箇条書きの入力欄用） */
const toLines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

export default function ProposalDocEditor({
  quote,
  calcs,
  devices,
  settings,
  onQuoteChange,
  onDeviceChange,
}: {
  quote: Quote;
  calcs: ProposalCalc[];
  devices: { byProposal: Record<string, DeviceSpec | undefined>; current?: DeviceSpec };
  settings: Settings;
  onQuoteChange: (patch: Partial<Quote>) => void;
  onDeviceChange: (device: DeviceSpec) => void;
}) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const doc = quote.proposalDoc ?? {};
  const patchDoc = (patch: Partial<NonNullable<Quote["proposalDoc"]>>) =>
    onQuoteChange({ proposalDoc: { ...doc, ...patch } });

  /** 写真を選んで保存し、ファイル名を受け取る */
  async function uploadPhoto(file: File): Promise<string | undefined> {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/photos", { method: "POST", body });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "写真を保存できませんでした。");
      return undefined;
    }
    return json.photo as string;
  }

  /** 機種DBに保存する（写真・オプションは機種に紐づく） */
  async function saveDevice(device: DeviceSpec) {
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(device),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "機種DBに保存できませんでした。");
      return;
    }
    onDeviceChange(json as DeviceSpec);
  }

  /** メーカーサイトからオプション一覧を取得する */
  async function fetchOptions(device: DeviceSpec) {
    setBusy(`${device.model} のオプションを取得中…`);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/devices/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: device.model, maker: device.maker }),
      });
      const json = (await res.json()) as { options?: DeviceOption[]; message?: string };
      if (!json.options?.length) {
        setError(json.message ?? "オプションを取得できませんでした。下の「オプションを追加」から手で登録してください。");
        return;
      }
      await saveDevice({ ...device, options: json.options });
      setMessage(`${json.options.length}件のオプションを取得しました。定価と品名をご確認ください。`);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel">
      <h2>提案資料（写真入りのご提案書）</h2>
      <p className="muted">
        見積書・比較表とは別に、お客様にお渡しする資料を作ります。
        現行機と提案機の写真、オプション一覧（写真付き）が入ります。
        オプションは<b>金額を載せず、付けた場合に月々いくら増えるか</b>だけを記載します
        （定価の{Math.round(settings.proposalDoc.optionPriceRate * 100)}%で計算）。
      </p>

      {busy && <p className="spinner">{busy}</p>}
      {message && <p className="badge">{message}</p>}
      {error && <p className="error">{error}</p>}

      <h3>表紙・本文</h3>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 280 }}>
          <label>標題</label>
          <input
            value={doc.title ?? ""}
            placeholder={settings.proposalDoc.title}
            onChange={(e) => patchDoc({ title: e.target.value })}
          />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 320 }}>
          <label>リード文（表紙）</label>
          <textarea
            rows={3}
            value={doc.lead ?? ""}
            placeholder={settings.proposalDoc.lead}
            onChange={(e) => patchDoc({ lead: e.target.value })}
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>現状の課題（1行に1つ）</label>
          <textarea
            rows={4}
            value={(doc.issues ?? []).join("\n")}
            placeholder={"印刷が遅く、朝の混雑時に待ちが出ている\nカラーの単価が高く、月々の負担が大きい"}
            onChange={(e) => patchDoc({ issues: toLines(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>ご提案のポイント（1行に1つ・空欄なら既定文）</label>
          <textarea
            rows={4}
            value={(doc.highlights ?? []).join("\n")}
            placeholder={settings.proposalDoc.highlights.join("\n")}
            onChange={(e) => patchDoc({ highlights: toLines(e.target.value) })}
          />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1, minWidth: 320 }}>
          <label>結びの文</label>
          <textarea
            rows={2}
            value={doc.closing ?? ""}
            placeholder="ご不明な点やご要望がございましたら、何なりとお申し付けください。"
            onChange={(e) => patchDoc({ closing: e.target.value })}
          />
        </div>
      </div>

      <h3>現在ご利用の複合機の写真</h3>
      <PhotoField
        photo={doc.currentPhoto ?? devices.current?.photo}
        label={quote.current.modelText || "現行機"}
        onPick={async (file) => {
          const photo = await uploadPhoto(file);
          if (photo) patchDoc({ currentPhoto: photo });
        }}
        onClear={() => patchDoc({ currentPhoto: undefined })}
      />

      {calcs.map((calc) => {
        const device = devices.byProposal[calc.proposal.id];
        return (
          <div key={calc.proposal.id} className="card" style={{ marginTop: 14 }}>
            <h3 style={{ marginTop: 0 }}>
              {MAKER_LABELS[calc.proposal.maker]}　{calc.proposal.modelText}
            </h3>
            {!device && (
              <p className="warn">
                この機種が機種DBにありません。上の「提案の作成」でスペックを取得すると、
                写真とオプションを登録できるようになります。
              </p>
            )}
            {device && (
              <>
                <PhotoField
                  photo={device.photo}
                  label={device.model}
                  onPick={async (file) => {
                    const photo = await uploadPhoto(file);
                    if (photo) await saveDevice({ ...device, photo });
                  }}
                  onClear={() => saveDevice({ ...device, photo: undefined })}
                />

                <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
                  <strong style={{ fontSize: 13 }}>オプション</strong>
                  <button className="secondary" disabled={!!busy} onClick={() => fetchOptions(device)}>
                    メーカーサイトから取得
                  </button>
                  <button
                    className="secondary"
                    onClick={() => saveDevice({ ...device, options: [...(device.options ?? []), emptyOption()] })}
                  >
                    オプションを追加
                  </button>
                </div>

                {!device.options?.length ? (
                  <p className="muted">
                    オプションが登録されていません。「メーカーサイトから取得」か「オプションを追加」で登録してください。
                  </p>
                ) : (
                  <OptionTable
                    device={device}
                    leaseTerm={calc.proposal.leaseTerm}
                    settings={settings}
                    selected={calc.proposal.optionIds}
                    onSave={saveDevice}
                    onUpload={uploadPhoto}
                    onSelect={(ids) =>
                      onQuoteChange({
                        proposals: quote.proposals.map((p) =>
                          p.id === calc.proposal.id ? { ...p, optionIds: ids } : p,
                        ),
                      })
                    }
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** 写真1枚の入力欄（アップロード・プレビュー・削除） */
function PhotoField({
  photo,
  label,
  onPick,
  onClear,
}: {
  photo?: string;
  label: string;
  onPick: (file: File) => void | Promise<void>;
  onClear: () => void;
}) {
  return (
    <div className="row" style={{ alignItems: "center" }}>
      <div
        style={{
          width: 150,
          height: 110,
          border: "1px solid var(--border)",
          borderRadius: 4,
          background: "#f4f7fa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/photos/${photo}`}
            alt={label}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : (
          "写真未登録"
        )}
      </div>
      <div className="field" style={{ width: 260 }}>
        <label>写真を選ぶ（JPEG / PNG / WebP）</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPick(file);
            e.target.value = "";
          }}
        />
      </div>
      {photo && (
        <button className="secondary" onClick={onClear}>
          写真を外す
        </button>
      )}
    </div>
  );
}

/** オプション一覧の編集（機種DBに保存する） */
function OptionTable({
  device,
  leaseTerm,
  settings,
  selected,
  onSave,
  onUpload,
  onSelect,
}: {
  device: DeviceSpec;
  leaseTerm: number;
  settings: Settings;
  selected?: string[];
  onSave: (device: DeviceSpec) => void | Promise<void>;
  onUpload: (file: File) => Promise<string | undefined>;
  onSelect: (ids: string[] | undefined) => void;
}) {
  const options = device.options ?? [];
  const patch = (id: string, p: Partial<DeviceOption>) =>
    onSave({ ...device, options: options.map((o) => (o.id === id ? { ...o, ...p } : o)) });

  // 未選択（undefined）は「すべて載せる」の意味
  const isOn = (id: string) => !selected || selected.includes(id);
  const toggle = (id: string, on: boolean) => {
    const current = selected ?? options.map((o) => o.id);
    const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    onSelect(next.length === options.length ? undefined : next);
  };

  return (
    <table style={{ marginTop: 8 }}>
      <thead>
        <tr>
          <th style={{ width: 40 }}>掲載</th>
          <th style={{ width: 70 }}>写真</th>
          <th>品名</th>
          <th style={{ width: 120 }}>型番</th>
          <th style={{ width: 110 }} className="num">定価</th>
          <th style={{ width: 110 }} className="num">月額 +</th>
          <th style={{ width: 60 }}></th>
        </tr>
      </thead>
      <tbody>
        {options.map((o) => {
          const { monthlyLeaseAdd } = optionMonthlyLease(o.listPrice, leaseTerm, settings);
          return (
            <tr key={o.id}>
              <td className="center">
                <input type="checkbox" checked={isOn(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
              </td>
              <td>
                <label style={{ cursor: "pointer", display: "block" }}>
                  {o.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/photos/${o.photo}`}
                      alt={o.name}
                      style={{ width: 56, height: 42, objectFit: "contain", background: "#f4f7fa" }}
                    />
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>
                      写真を選ぶ
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      const photo = await onUpload(file);
                      if (photo) patch(o.id, { photo });
                    }}
                  />
                </label>
              </td>
              <td>
                <input
                  style={{ width: "100%" }}
                  value={o.name}
                  onChange={(e) => patch(o.id, { name: e.target.value })}
                />
                <input
                  style={{ width: "100%", marginTop: 3, fontSize: 12 }}
                  placeholder="提案資料に載せる短い説明（任意）"
                  value={o.description ?? ""}
                  onChange={(e) => patch(o.id, { description: e.target.value })}
                />
              </td>
              <td>
                <input
                  style={{ width: "100%" }}
                  value={o.modelCode ?? ""}
                  onChange={(e) => patch(o.id, { modelCode: e.target.value })}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  style={{ width: 100 }}
                  value={o.listPrice}
                  onChange={(e) => patch(o.id, { listPrice: Number(e.target.value) || 0 })}
                />
              </td>
              <td className="num">
                <strong>+{yen(monthlyLeaseAdd)}</strong>
              </td>
              <td>
                <button
                  className="secondary"
                  style={{ padding: "2px 8px" }}
                  onClick={() => onSave({ ...device, options: options.filter((x) => x.id !== o.id) })}
                >
                  削除
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
