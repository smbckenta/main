"use client";

import { useRef, useState } from "react";
import { ROLE_LABELS, type DocRole } from "@/lib/doc-roles";
import type { CurrentCalc, ProposalCalc, Quote, ServiceArea } from "@/lib/types";

/**
 * お預かりした資料の一覧と、追加の読み取り。
 *
 * 「どのファイルを読み取ったのか」が分かることが大事なので、
 * 原本そのものを案件に残し、画面から開けるようにしている。
 * 数字が合わないときは、まず原本を開いて見比べることになる。
 */

const KIND_LABELS: Record<string, string> = {
  pdf: "PDF",
  image: "写真・画像",
  excel: "Excel",
  csv: "CSV",
  text: "テキスト",
  unknown: "不明",
};

const jstDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
        d.getMinutes(),
      ).padStart(2, "0")}`;
};

export default function DocumentsPanel({
  quote,
  onResult,
}: {
  quote: Quote;
  onResult: (json: {
    quote: Quote;
    current: CurrentCalc;
    proposals: ProposalCalc[];
    serviceArea?: ServiceArea;
    ingest?: { warnings: string[] };
  }) => void;
}) {
  const [role, setRole] = useState<DocRole>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  const files = quote.ingest?.files ?? [];

  async function readFiles(list: FileList) {
    setBusy(true);
    setError("");
    setWarnings([]);
    try {
      const form = new FormData();
      for (const f of Array.from(list)) {
        form.append("files", f);
        form.append("roles", role);
      }
      const res = await fetch(`/api/quotes/${quote.id}/documents`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "解析に失敗しました。");
      onResult(json);
      setWarnings(json.ingest?.warnings ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <section className="panel">
      <h2>お預かりした資料</h2>
      <p className="muted">
        追加でお預かりした契約書・カウンター明細をここから読み取れます。
        読み取れた項目だけが現行機に反映され、手で直した内容はそのまま残ります。
      </p>

      <div className="row">
        <div className="field" style={{ width: 220 }}>
          <label>書類の種類（分かる場合）</label>
          <select value={role} onChange={(e) => setRole(e.target.value as DocRole)}>
            <option value="unknown">自動で判定</option>
            <option value="lease">リース契約書</option>
            <option value="schedule">リース支払予定表</option>
            <option value="counter">カウンター明細</option>
          </select>
        </div>
        <div className="field" style={{ width: 320 }}>
          <label>資料を追加して読み取る（PDF・写真）</label>
          <input
            ref={picker}
            type="file"
            multiple
            accept=".pdf,image/*,.xlsx,.csv,.txt"
            disabled={busy}
            onChange={(e) => {
              const list = e.target.files;
              if (list?.length) void readFiles(list);
            }}
          />
        </div>
      </div>

      {busy && <p className="spinner">読み取っています… 写真やスキャンPDFは1ファイル数十秒かかることがあります。</p>}
      {error && <p className="error">{error}</p>}
      {warnings.map((w, i) => (
        <p key={i} className="warn">
          {w}
        </p>
      ))}

      {files.length === 0 ? (
        <p className="muted">まだ資料を読み取っていません。</p>
      ) : (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>ファイル</th>
              <th style={{ width: 110 }}>種類</th>
              <th style={{ width: 130 }}>書類</th>
              <th style={{ width: 110 }}>読み取り</th>
              <th style={{ width: 150 }}>読み取った日時</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={`${f.name}-${i}`}>
                <td>{f.name}</td>
                <td>{KIND_LABELS[f.kind] ?? f.kind}</td>
                <td>{ROLE_LABELS[f.role as DocRole] ?? f.role}</td>
                <td>
                  {f.aiUsed ? (
                    <span className="badge">AI読み取り</span>
                  ) : f.ocrUsed ? (
                    <span className="badge">文字起こし</span>
                  ) : (
                    <span className="muted">テキスト</span>
                  )}
                </td>
                <td className="muted">{jstDateTime(f.parsedAt)}</td>
                <td>
                  {f.file ? (
                    <a
                      className="badge"
                      href={`/api/quotes/${quote.id}/documents/${f.file}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      原本を開く
                    </a>
                  ) : (
                    <span className="muted" title="この版より前に読み取った資料は保管されていません">
                      －
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
