"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_LABELS } from "@/lib/doc-roles";
import type { IngestResult } from "@/lib/ingest";

/** リース契約書・印刷明細をアップロードして案件を新規作成する */
export default function NewQuoteForm() {
  const router = useRouter();
  const [files, setFiles] = useState<FileList | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [title, setTitle] = useState("複合機入替のご提案");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState("");

  async function analyze() {
    if (!files?.length) {
      setError("ファイルを選択してください。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "解析に失敗しました。");
      setResult(json as IngestResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          title,
          current: result?.current,
          ingest: result
            ? {
                counter: result.counter,
                lease: result.lease,
                files: result.files,
                warnings: result.warnings,
              }
            : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "作成に失敗しました。");
      router.push(`/quotes/${json.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>資料から新規作成</h2>
      <p className="muted">
        リース契約書・リース支払予定表・印刷明細書（カウンター明細）を選択してください。
        PDF / 写真・画像（JPEG・PNG・HEIC）/ Excel / CSV に対応しています。
        文字データを持たないスキャンPDFや、スマホで撮った書類の写真は自動で文字起こし（OCR）します。
      </p>
      <div className="row">
        <div className="field" style={{ minWidth: 320 }}>
          <label>資料（複数選択可）</label>
          <input
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls,.xlsm,.csv,.tsv,.txt,.jpg,.jpeg,.png,.webp,.heic,.heif,.tif,.tiff,image/*"
            onChange={(e) => setFiles(e.target.files)}
          />
        </div>
        <div className="field">
          <label>お客様名</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="株式会社○○" />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label>件名</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <button onClick={analyze} disabled={busy}>
          {busy ? "解析中…（写真は1枚あたり数秒かかります）" : "資料を解析"}
        </button>
        <button className="secondary" onClick={create} disabled={busy}>
          {result ? "この内容で案件を作成" : "空の案件を作成"}
        </button>
      </div>

      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <h3>読み取り結果</h3>
          <div className="grid2">
            <div className="card">
              <h3>現行機</h3>
              <table>
                <tbody>
                  <tr><th>メーカー</th><td>{result.current.makerText || "－"}</td></tr>
                  <tr><th>機種</th><td>{result.current.modelText || "－"}</td></tr>
                  <tr><th>月額リース料</th><td className="num">{result.current.monthlyLease.toLocaleString()}円</td></tr>
                  <tr><th>リース期間</th><td>{result.current.leaseTerm ? `${result.current.leaseTerm}回` : "－"}</td></tr>
                  <tr><th>リース満了</th><td>{result.current.leaseEnd ?? "－"}</td></tr>
                  <tr>
                    <th>残債</th>
                    <td className="num">
                      {result.current.remainingDebt
                        ? `${result.current.remainingDebt.toLocaleString()}円`
                        : "－"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>月間印刷枚数・単価</h3>
              <table>
                <tbody>
                  <tr><th>モノクロ</th><td className="num">{result.current.monoPages.toLocaleString()}枚 / {result.current.units.mono}円</td></tr>
                  <tr><th>フルカラー</th><td className="num">{result.current.colorPages.toLocaleString()}枚 / {result.current.units.color}円</td></tr>
                  <tr><th>2色カラー</th><td className="num">{result.current.twoColorPages.toLocaleString()}枚 / {result.current.units.twoColor}円</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <h3>読み込んだファイル</h3>
          <table>
            <thead>
              <tr><th>ファイル</th><th>形式</th><th>種類</th><th>読み取り方法</th><th className="num">認識行数</th></tr>
            </thead>
            <tbody>
              {result.files.map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td>{f.kind === "image" ? "画像" : f.kind}</td>
                  <td>{ROLE_LABELS[f.role]}</td>
                  <td>{f.ocrUsed ? <span className="badge">OCR（文字起こし）</span> : "テキスト抽出"}</td>
                  <td className="num">{f.lineCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.files.some((f) => f.ocrUsed) && (
            <p className="warn" style={{ marginTop: 10 }}>
              写真・スキャンPDFの読み取り結果は誤認識が起こりえます。枚数・単価・リース料は必ず原本と照合してください。
            </p>
          )}

          {result.warnings.length > 0 && (
            <p className="warn" style={{ marginTop: 12 }}>{result.warnings.join("\n")}</p>
          )}
          <p className="muted">
            読み取りは推定値です。案件作成後の編集画面で必ず内容をご確認ください。
          </p>
        </div>
      )}
    </section>
  );
}
