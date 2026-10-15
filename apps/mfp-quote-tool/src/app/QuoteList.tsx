"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DeletionRecord, Quote } from "@/lib/types";

/**
 * 案件一覧と削除。
 * 削除は「担当者を選ぶ」「削除パスワードを入れる」の2つを必須にし、
 * 誰がいつ何を消したかを記録として残す（記録は下の削除履歴に出る）。
 */
export default function QuoteList({
  quotes,
  staff,
  log,
  passwordSet,
}: {
  quotes: Quote[];
  staff: string[];
  log: DeletionRecord[];
  passwordSet: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<Quote | null>(null);
  const [deletedBy, setDeletedBy] = useState(staff[0] ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);

  function open(quote: Quote) {
    setTarget(quote);
    setPassword("");
    setError("");
  }

  async function remove() {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/quotes/${target.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, deletedBy }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "削除に失敗しました。");
      setTarget(null);
      setPassword("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>案件一覧</h2>

      {quotes.length === 0 ? (
        <p className="muted">
          まだ案件がありません。上の「資料から新規作成」でリース契約書と印刷明細を読み込んでください。
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>見積日</th>
              <th>見積番号</th>
              <th>お客様</th>
              <th>件名</th>
              <th>担当者</th>
              <th>エリア</th>
              <th>提案</th>
              <th>更新</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>{q.quoteDate}</td>
                <td>{q.quoteNo}</td>
                <td>
                  <Link href={`/quotes/${q.id}`}>{q.customerName || "(未入力)"}</Link>
                </td>
                <td>{q.title}</td>
                <td>{q.staffName ?? "－"}</td>
                <td>{q.area}</td>
                <td>{q.proposals.length}社</td>
                <td className="muted">{q.updatedAt.slice(0, 16).replace("T", " ")}</td>
                <td>
                  <button className="danger" onClick={() => open(q)}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {target && (
        <div className="card" style={{ marginTop: 16, maxWidth: 560 }}>
          <h3>案件を削除します</h3>
          <p>
            {target.quoteDate}／見積番号 {target.quoteNo}／
            <strong>{target.customerName || "(未入力)"}</strong>／{target.title}
          </p>
          <p className="warn">
            この操作は元に戻せません（データは復旧用に残りますが、一覧からは消えます）。
            削除した担当者・日時は記録に残ります。
          </p>
          {!passwordSet ? (
            <p className="error">
              削除パスワードが未設定です。<Link href="/settings">設定画面</Link>の「案件の削除」で
              パスワードを設定してください。
            </p>
          ) : (
            <>
              <div className="row">
                <div className="field" style={{ width: 220 }}>
                  <label>削除する担当者</label>
                  <select value={deletedBy} onChange={(e) => setDeletedBy(e.target.value)}>
                    {staff.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>削除パスワード</label>
                  <input
                    type="password"
                    value={password}
                    autoComplete="off"
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") remove();
                    }}
                  />
                </div>
              </div>
              {error && <p className="error">{error}</p>}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="danger" onClick={remove} disabled={busy || !password}>
                  {busy ? "削除中…" : "削除する"}
                </button>
                <button className="secondary" onClick={() => setTarget(null)} disabled={busy}>
                  やめる
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="secondary" onClick={() => setShowLog((v) => !v)}>
          {showLog ? "削除履歴を閉じる" : `削除履歴（${log.length}件）`}
        </button>
        {showLog &&
          (log.length === 0 ? (
            <p className="muted">削除された案件はありません。</p>
          ) : (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>削除日時</th>
                  <th>削除した担当者</th>
                  <th>見積番号</th>
                  <th>お客様</th>
                  <th>件名</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={`${r.quoteId}-${r.deletedAt}`}>
                    <td>{r.deletedAt.slice(0, 16).replace("T", " ")}</td>
                    <td>
                      <strong>{r.deletedBy}</strong>
                    </td>
                    <td>{r.quoteNo}</td>
                    <td>{r.customerName || "(未入力)"}</td>
                    <td>{r.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </section>
  );
}
