"use client";

import { useEffect, useState } from "react";
import { MAKERS, MAKER_LABELS } from "@/lib/types";
import type { Maker, PriceBook, PriceBookEntry } from "@/lib/types";

/** 見積明細の合計。定価と食い違う場合は注意表示する（出典が異なる資料の混在を検知するため） */
function itemsTotalCell(e: PriceBookEntry) {
  if (!e.items.length) return <span className="muted">未登録</span>;
  const total = e.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const diff = total - e.listPrice;
  return (
    <>
      {total.toLocaleString()}
      {Math.abs(diff) > 0 && (
        <span className="cut" title="仕切表の定価と見積明細の合計が一致していません">
          {" "}
          ({diff > 0 ? "+" : ""}
          {diff.toLocaleString()})
        </span>
      )}
    </>
  );
}

const empty: PriceBookEntry = {
  id: "",
  maker: "KYOCERA",
  model: "",
  category: "A3カラー",
  gradePpm: 25,
  listPrice: 0,
  cost: 0,
  items: [],
};

/** 仕切表（定価・仕切率・仕切価格）の閲覧と編集 */
export default function PriceBookPage() {
  const [book, setBook] = useState<PriceBook | null>(null);
  const [filter, setFilter] = useState<Maker | "ALL">("ALL");
  const [draft, setDraft] = useState<PriceBookEntry>(empty);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/pricebook").then((r) => r.json()).then(setBook);
  }, []);

  async function save(entry: PriceBookEntry) {
    const payload = {
      ...entry,
      id: entry.id || `${entry.maker.toLowerCase()}-${entry.model.replace(/\s+/g, "-").toLowerCase()}`,
      costRate: entry.listPrice > 0 ? Math.round((entry.cost / entry.listPrice) * 1000) / 1000 : undefined,
    };
    const res = await fetch("/api/pricebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setBook(await (await fetch("/api/pricebook")).json());
      setDraft(empty);
      setMessage(`${payload.model} を保存しました。`);
    } else {
      setMessage((await res.json()).error ?? "保存に失敗しました。");
    }
  }

  async function remove(id: string) {
    if (!confirm("この機種を仕切表から削除しますか？")) return;
    await fetch(`/api/pricebook?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBook(await (await fetch("/api/pricebook")).json());
  }

  if (!book) return <p className="spinner">読み込み中…</p>;

  const entries = book.entries.filter((e) => filter === "ALL" || e.maker === filter);

  return (
    <>
      <section className="panel">
        <h2>仕切表</h2>
        <p className="muted">
          {book.source}（版：{book.version}）— {book.note}
        </p>
        <div className="row">
          <div className="field" style={{ width: 200 }}>
            <label>メーカーで絞り込み</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Maker | "ALL")}>
              <option value="ALL">すべて</option>
              {MAKERS.map((m) => (
                <option key={m} value={m}>
                  {MAKER_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {message && <p className="warn" style={{ marginTop: 10 }}>{message}</p>}

        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>メーカー</th>
              <th>機種</th>
              <th>構成</th>
              <th>区分</th>
              <th className="num">枚機</th>
              <th className="num">定価</th>
              <th className="num">仕切率</th>
              <th className="num">仕切価格</th>
              <th className="num">明細合計</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{MAKER_LABELS[e.maker]}</td>
                <td>{e.model}</td>
                <td>{e.config ?? "－"}</td>
                <td>{e.category}</td>
                <td className="num">{e.gradePpm}</td>
                <td className="num">{e.listPrice.toLocaleString()}</td>
                <td className="num">
                  {e.costRateMin
                    ? `${Math.round(e.costRateMin * 100)}〜${Math.round((e.costRateMax ?? 0) * 100)}%`
                    : e.costRate
                      ? `${Math.round(e.costRate * 100)}%`
                      : "－"}
                </td>
                <td className="num">
                  {e.costMin ? `${e.costMin.toLocaleString()}〜${(e.costMax ?? 0).toLocaleString()}` : e.cost.toLocaleString()}
                </td>
                <td className="num">{itemsTotalCell(e)}</td>
                <td>
                  <button className="secondary" onClick={() => setDraft(e)}>
                    編集
                  </button>{" "}
                  <button className="danger" onClick={() => remove(e.id)}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>{draft.id ? "機種の編集" : "機種の追加"}</h2>
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
          <div className="field" style={{ width: 220 }}>
            <label>機種名</label>
            <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          </div>
          <div className="field" style={{ width: 100 }}>
            <label>構成</label>
            <input value={draft.config ?? ""} onChange={(e) => setDraft({ ...draft, config: e.target.value })} />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>区分</label>
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
          </div>
          <div className="field" style={{ width: 100 }}>
            <label>枚機</label>
            <input
              type="number"
              value={draft.gradePpm}
              onChange={(e) => setDraft({ ...draft, gradePpm: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>定価</label>
            <input
              type="number"
              value={draft.listPrice}
              onChange={(e) => setDraft({ ...draft, listPrice: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>仕切価格</label>
            <input
              type="number"
              value={draft.cost}
              onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value) })}
            />
          </div>
          <button onClick={() => save(draft)} disabled={!draft.model}>
            保存
          </button>
          <button className="secondary" onClick={() => setDraft(empty)}>
            クリア
          </button>
        </div>

        <h3>見積明細のひな型</h3>
        <table>
          <thead>
            <tr>
              <th>品名</th>
              <th style={{ width: 80 }}>数量</th>
              <th style={{ width: 70 }}>単位</th>
              <th style={{ width: 140 }} className="num">定価</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {draft.items.map((item, i) => (
              <tr key={i}>
                <td>
                  <input
                    style={{ width: "100%" }}
                    value={item.name}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={item.qty}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((x, j) => (i === j ? { ...x, qty: Number(e.target.value) } : x)),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    style={{ width: "100%" }}
                    value={item.unit}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((x, j) => (i === j ? { ...x, unit: e.target.value } : x)),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((x, j) => (i === j ? { ...x, unitPrice: Number(e.target.value) } : x)),
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    className="danger"
                    onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}
                  >
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
          onClick={() => setDraft({ ...draft, items: [...draft.items, { name: "", qty: 1, unit: "台", unitPrice: 0 }] })}
        >
          明細を追加
        </button>
      </section>
    </>
  );
}
