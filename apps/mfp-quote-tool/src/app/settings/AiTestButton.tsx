"use client";

import { useState } from "react";
import { checkApiKey } from "@/lib/ai/api-key";
import type { AiTestResult } from "../api/ai/test/route";

/**
 * 「本当にAIで読み取れるのか」をその場で確かめるボタン。
 *
 * キーが入っているだけでは足りず、キーが失効している・残高が無い・
 * モデル名が違う、といった失敗は呼んでみて初めて分かる。
 * 資料を読み込ませてから気づくと、精度が落ちた見積が出来上がってしまう。
 *
 * 保存前の入力内容で試せるようにしてある。保存を挟むと、
 * 「直したつもりが直っていない」ときに何を試したのか分からなくなる。
 */
export default function AiTestButton({ apiKey, model }: { apiKey: string; model: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);

  const key = apiKey.trim();
  // 入力した瞬間に長さが分かるようにする。貼り付けが途中で切れているかは
  // 見た目では分からず、文字数だけが手がかりになる。
  const shape = key ? checkApiKey(key) : undefined;

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, model }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`アプリ側で問題が起きました（${res.status}）。`);
      setResult((await res.json()) as AiTestResult);
    } catch (err) {
      // 「Failed to fetch」だけ出しても何のことか分からないので、
      // 何が起きているのかと、まず何をすればよいかを書く
      const raw = (err as Error).message;
      const message = /Failed to fetch|NetworkError|timed out|aborted/i.test(raw)
        ? `このアプリ本体に問い合わせできませんでした（${raw}）。` +
          "start.bat の黒い画面を閉じてしまっていないかご確認のうえ、いったん閉じて start.bat から開き直してください。"
        : raw;
      setResult({ ok: false, message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {key && (
        <p className={shape ? "error" : "badge"} style={{ display: "block", marginBottom: 8 }}>
          入力中のAPIキー：{key.length}文字
          {shape ? ` － ${shape}` : "（長さは正しそうです。下のボタンで実際につながるか確かめてください）"}
        </p>
      )}
      <button className="secondary" onClick={run} disabled={busy || !key}>
        {busy ? "確認しています…" : "AI読み取りの接続テスト"}
      </button>
      <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
        いま入力されているキーで試します（保存前でも構いません）。ごく短い問い合わせを1回だけ送ります（1円未満）。
      </span>
      {result && (
        <p className={result.ok ? "badge" : "error"} style={{ marginTop: 8, display: "block" }}>
          {result.ok ? `つながりました（${result.model}）。設定を保存してお使いください。` : result.message}
        </p>
      )}
    </div>
  );
}
