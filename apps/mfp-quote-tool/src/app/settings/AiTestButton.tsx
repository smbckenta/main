"use client";

import { useState } from "react";
import type { AiTestResult } from "../api/ai/test/route";

/**
 * 「本当にAIで読み取れるのか」をその場で確かめるボタン。
 *
 * キーが入っているだけでは足りず、キーが失効している・残高が無い・
 * モデル名が違う、といった失敗は呼んでみて初めて分かる。
 * 資料を読み込ませてから気づくと、精度が落ちた見積が出来上がってしまう。
 */
export default function AiTestButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/test", { method: "POST" });
      setResult((await res.json()) as AiTestResult);
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="secondary" onClick={run} disabled={busy}>
        {busy ? "確認しています…" : "AI読み取りの接続テスト"}
      </button>
      <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
        設定を保存してから押してください。ごく短い問い合わせを1回だけ送ります（1円未満）。
      </span>
      {result && (
        <p className={result.ok ? "badge" : "error"} style={{ marginTop: 8, display: "block" }}>
          {result.ok ? `つながりました（${result.model}）。AIで読み取れます。` : result.message}
        </p>
      )}
    </div>
  );
}
