"use client";

import { useEffect, useState } from "react";
import type { AiStatus } from "./api/ai/status/route";

/**
 * AI読み取りが使える状態かを、資料を読ませる画面に必ず出す。
 *
 * APIキーが無いと黙ってOCR（文字起こし）に切り替わる。それでも
 * 何かしら読めてしまうので、精度が落ちていることに気づけないまま
 * 見積を作ってしまう。読み込ませる前に分かるようにしておく。
 */
export default function AiStatusBanner() {
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  if (status.ready) {
    return (
      <p className="badge" style={{ display: "inline-block", marginBottom: 10 }}>
        AI読み取り：使えます（{status.model}）
      </p>
    );
  }

  return (
    <div className="error" style={{ marginBottom: 12 }}>
      <strong>AI読み取りが使えません。このままだと精度が大きく落ちます。</strong>
      <br />
      {status.message}
      <br />
      <span style={{ fontSize: 13 }}>
        {status.enabled ? (
          <>
            <a href="/settings">設定画面</a>の「AIによる書類の読み取り」にAPIキー（sk-ant-…）を貼り付けて保存してください。
            キーは <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
              Claude Console
            </a> で発行できます。
            <br />
            設定画面を使わない場合は、次のフォルダに <code>api-key.txt</code> を作ってキーだけを書いても構いません。
            <br />
            <code>{status.dataDir}</code>
          </>
        ) : (
          <>
            <a href="/settings">設定画面</a>の「AIで読み取る」を「使う（推奨）」に変えてください。
          </>
        )}
      </span>
    </div>
  );
}
