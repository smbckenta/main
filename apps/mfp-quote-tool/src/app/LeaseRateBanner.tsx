"use client";

import { useEffect, useState } from "react";
import {
  describeRates,
  isOutdatedLeaseRates,
  LEASE_RATES_EFFECTIVE,
  STANDARD_LEASE_RATES,
} from "@/lib/lease-rates";
import type { Settings } from "@/lib/types";
import { useAuthState } from "./useAuthState";

/**
 * 保存されているリース料率が古いときに知らせる。
 *
 * 料率はリース会社の改定で変わる。ツールを配り直しても、
 * 保存先に設定ファイルが残っていればそちらが優先されるので、
 * 古い料率のまま見積を出し続けてしまう。
 *
 * 料率が低いままだと月額リース料を安く見せてしまい、
 * そのまま契約するとリース会社の請求と合わなくなる。
 * 気づかないのがいちばん困るので、見積を作る画面にも出す。
 *
 * 書き換えるかどうかは人が決める（勝手に金額を変えない）。
 */
export default function LeaseRateBanner() {
  const [rates, setRates] = useState<Settings["leaseRates"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const { canEditMasters } = useAuthState();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: Settings) => setRates(s.leaseRates))
      .catch(() => setRates(null));
  }, []);

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const current = (await (await fetch("/api/settings")).json()) as Settings;
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, leaseRates: { ...STANDARD_LEASE_RATES } }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "更新できませんでした。");
      setRates({ ...STANDARD_LEASE_RATES });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!rates || !isOutdatedLeaseRates(rates)) return null;

  return (
    <div className="warn" style={{ marginBottom: 10 }}>
      <strong>リース料率が古いままです。</strong>
      <br />
      いま保存されているのは「{describeRates(rates)}」ですが、
      {LEASE_RATES_EFFECTIVE}より「{describeRates(STANDARD_LEASE_RATES)}」に改定されています。
      このままだと月額リース料を安く見せてしまい、契約後にリース会社の請求と合わなくなります。
      {canEditMasters ? (
        <div style={{ marginTop: 8 }}>
          <button onClick={apply} disabled={busy || done}>
            {busy ? "更新中…" : done ? "更新しました" : "最新の料率に更新する"}
          </button>
          {error && <span className="error" style={{ marginLeft: 8 }}>{error}</span>}
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>管理者の方に、設定の更新をご依頼ください。</div>
      )}
    </div>
  );
}
