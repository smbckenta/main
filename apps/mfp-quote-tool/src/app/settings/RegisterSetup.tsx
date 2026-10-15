"use client";

import { useState } from "react";

/**
 * 台帳（Apps Script）の下ごしらえ。
 *
 * 台帳のURLを貼ると、スプレッドシートIDと合言葉を埋め込んだスクリプトを作る。
 * 利用者は「コピー → Apps Scriptに貼る → デプロイ → URLを貼り戻す」だけでよく、
 * IDや合言葉を手で書き写す必要がない（ここがいちばん間違いやすい）。
 */
export default function RegisterSetup({
  spreadsheet,
  onSpreadsheet,
  onToken,
}: {
  spreadsheet: string;
  onSpreadsheet: (value: string) => void;
  onToken: (token: string) => void;
}) {
  const [script, setScript] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function build() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/register/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheet }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "スクリプトを作れませんでした。");
        return;
      }
      setScript(json.script);
      // 合言葉はツール側にも同じものを入れておく（ずれようがない）
      onToken(json.token);
      onSpreadsheet(json.spreadsheetId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。下の枠を全選択してコピーしてください。");
    }
  }

  return (
    <div className="setup-box">
      <div className="row">
        <div className="field" style={{ width: 520 }}>
          <label>台帳のスプレッドシートURL（ブラウザのURLをそのまま貼ってください）</label>
          <input
            value={spreadsheet}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit"
            onChange={(e) => onSpreadsheet(e.target.value)}
          />
        </div>
        <button className="secondary" disabled={busy || !spreadsheet} onClick={build}>
          {busy ? "作成中…" : "貼るだけのスクリプトを作る"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {script && (
        <>
          <ol className="setup-steps">
            <li>
              下の枠の中身をコピー（
              <button className="secondary" onClick={copy}>
                {copied ? "コピーしました" : "クリップボードにコピー"}
              </button>
              ）
            </li>
            <li>
              <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">
                script.google.com で新しいプロジェクトを作る
              </a>
              → 中身をすべて消して貼り付け → 保存
            </li>
            <li>
              「デプロイ → 新しいデプロイ → 種類：<strong>ウェブアプリ</strong>」
              <br />
              実行するユーザー：<strong>自分</strong>／アクセスできるユーザー：<strong>全員</strong>
            </li>
            <li>
              表示された <strong>ウェブアプリのURL（/exec で終わるもの）</strong> を、下の「ウェブアプリのURL」に貼る
            </li>
            <li>「台帳につながるか確認」を押す（合言葉はこのツールに入力済みです）</li>
          </ol>
          <textarea className="setup-script" readOnly value={script} rows={10} spellCheck={false} />
        </>
      )}
    </div>
  );
}
