"use client";

import { useEffect, useState } from "react";
import { MAKERS, MAKER_LABELS } from "@/lib/types";
import type {
  CurrentCalc,
  LeaseTerm,
  Maker,
  PriceBook,
  Proposal,
  ProposalCalc,
  Quote,
  ServiceArea,
  Settings,
} from "@/lib/types";

const RANK_TEXT: Record<string, string> = {
  S: "S：管轄事務所から1時間以内で現地到着",
  A: "A：当日対応可能",
  B: "B：翌日対応",
  C: "C：翌々日以降の対応",
  D: "D：対応不可",
};

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
const sign = (n: number) =>
  n === 0 ? "±0" : n < 0 ? `▲${Math.abs(Math.round(n)).toLocaleString()}` : `+${Math.round(n).toLocaleString()}`;

export default function QuoteEditor({
  initialQuote,
  initialCurrent,
  initialProposals,
  initialServiceArea,
  settings,
}: {
  initialQuote: Quote;
  initialCurrent: CurrentCalc;
  initialProposals: ProposalCalc[];
  initialServiceArea?: ServiceArea;
  settings: Settings;
}) {
  const [quote, setQuote] = useState<Quote>(initialQuote);
  const [current, setCurrent] = useState<CurrentCalc>(initialCurrent);
  const [calcs, setCalcs] = useState<ProposalCalc[]>(initialProposals);
  const [serviceArea, setServiceArea] = useState<ServiceArea | undefined>(initialServiceArea);
  const [book, setBook] = useState<PriceBook | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 提案自動作成の条件
  const [makers, setMakers] = useState<Maker[]>(["KYOCERA", "TOSHIBA", "FUJIFILM"]);
  const [leaseTerm, setLeaseTerm] = useState<LeaseTerm>(72);
  const [fetchSpec, setFetchSpec] = useState(false);

  // 出力条件
  const [docs, setDocs] = useState<("quote" | "compare")[]>(["quote", "compare"]);
  const [formats, setFormats] = useState<("pdf" | "xlsx")[]>(["pdf", "xlsx"]);
  const [includeProfit, setIncludeProfit] = useState(false);

  useEffect(() => {
    fetch("/api/pricebook")
      .then((r) => r.json())
      .then(setBook)
      .catch(() => setBook(null));
  }, []);

  function patchQuote(patch: Partial<Quote>) {
    setQuote((q) => ({ ...q, ...patch }));
  }
  function patchCurrent(patch: Partial<Quote["current"]>) {
    setQuote((q) => ({ ...q, current: { ...q.current, ...patch } }));
  }
  function patchUnits(patch: Partial<Quote["current"]["units"]>) {
    setQuote((q) => ({ ...q, current: { ...q.current, units: { ...q.current.units, ...patch } } }));
  }
  function patchProposal(id: string, patch: Partial<Proposal>) {
    setQuote((q) => ({
      ...q,
      proposals: q.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }

  async function save() {
    setBusy("保存中…");
    setError("");
    try {
      const res = await fetch(`/api/quotes/${quote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quote),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "保存に失敗しました。");
      setQuote(json.quote);
      setCurrent(json.current);
      setCalcs(json.proposals);
      setServiceArea(json.serviceArea ?? undefined);
      setMessage("保存しました。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function generateProposals(replace: boolean) {
    if (!makers.length) {
      setError("メーカーを1社以上選択してください。");
      return;
    }
    setBusy("提案を作成中…");
    setError("");
    try {
      // 現在の入力内容を先に保存してから提案を組み立てる
      await fetch(`/api/quotes/${quote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quote),
      });
      const res = await fetch(`/api/quotes/${quote.id}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ makers, leaseTerm, fetchSpec, replace }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "提案の作成に失敗しました。");
      setQuote(json.quote);
      setCurrent(json.current);
      setCalcs(json.proposals);
      setServiceArea(json.serviceArea ?? undefined);
      setMessage(json.messages?.length ? json.messages.join("\n") : "提案を作成しました。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function lookupCurrentSpec() {
    if (!quote.current.modelText) {
      setError("現行機の型番を入力してください。");
      return;
    }
    setBusy("スペックを取得中…");
    setError("");
    try {
      const res = await fetch("/api/devices/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: quote.current.modelText }),
      });
      const json = await res.json();
      if (json.device) {
        patchCurrent({ deviceId: json.device.id, makerText: json.device.makerText ?? quote.current.makerText });
        setMessage(
          json.origin === "local"
            ? "機種DBからスペックを反映しました。"
            : `インターネットから取得しました（${json.url}）。`,
        );
      } else {
        setError(json.message ?? "スペックを取得できませんでした。");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function exportFiles() {
    setBusy("出力中…");
    setError("");
    try {
      await fetch(`/api/quotes/${quote.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quote),
      });
      const res = await fetch(`/api/quotes/${quote.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docs, formats, includeProfit }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "出力に失敗しました。" }));
        throw new Error(json.error);
      }
      const warn = res.headers.get("X-Export-Warnings");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''(.+)$/);
      const filename = match ? decodeURIComponent(match[1]) : "見積書.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(warn ? `出力しました（${decodeURIComponent(warn)}）` : "出力しました。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function removeProposal(id: string) {
    setQuote((q) => ({ ...q, proposals: q.proposals.filter((p) => p.id !== id) }));
  }

  const totalPages = quote.current.monoPages + quote.current.colorPages + quote.current.twoColorPages;

  return (
    <>
      <section className="panel">
        <h2>案件情報</h2>
        <div className="row">
          <Field label="お客様名" width={220}>
            <input value={quote.customerName} onChange={(e) => patchQuote({ customerName: e.target.value })} />
          </Field>
          <Field label="敬称" width={80}>
            <input value={quote.customerHonorific} onChange={(e) => patchQuote({ customerHonorific: e.target.value })} />
          </Field>
          <Field label="件名" width={240}>
            <input value={quote.title} onChange={(e) => patchQuote({ title: e.target.value })} />
          </Field>
          <Field label="見積番号" width={120}>
            <input value={quote.quoteNo} onChange={(e) => patchQuote({ quoteNo: e.target.value })} />
          </Field>
          <Field label="見積日" width={140}>
            <input type="date" value={quote.quoteDate} onChange={(e) => patchQuote({ quoteDate: e.target.value })} />
          </Field>
          <Field label="エリア" width={140}>
            <select value={quote.area} onChange={(e) => patchQuote({ area: e.target.value })}>
              {settings.areas.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                  {a.remote ? "（僻地）" : ""}
                </option>
              ))}
            </select>
          </Field>
          <button onClick={save} disabled={!!busy}>
            保存して再計算
          </button>
        </div>

        <h3>保守対応エリア（京セラ 全国担当エリア表）</h3>
        <ServiceAreaPicker
          value={quote.serviceArea}
          area={serviceArea}
          onSelect={(a) => {
            patchQuote({ serviceArea: { pref: a.pref, city: a.city } });
            setServiceArea(a);
          }}
        />

        {busy && <p className="spinner">{busy}</p>}
        {message && <p className="warn" style={{ marginTop: 10 }}>{message}</p>}
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      </section>

      <section className="panel">
        <h2>現行機（お預かり資料の読み取り結果）</h2>
        <div className="row">
          <Field label="メーカー" width={160}>
            <input value={quote.current.makerText} onChange={(e) => patchCurrent({ makerText: e.target.value })} />
          </Field>
          <Field label="機種" width={200}>
            <input value={quote.current.modelText} onChange={(e) => patchCurrent({ modelText: e.target.value })} />
          </Field>
          <button className="secondary" onClick={lookupCurrentSpec} disabled={!!busy}>
            スペックを取得
          </button>
          <Field label="月額リース料" width={130}>
            <NumberInput value={quote.current.monthlyLease} onChange={(v) => patchCurrent({ monthlyLease: v })} />
          </Field>
          <Field label="リース回数" width={100}>
            <NumberInput value={quote.current.leaseTerm ?? 0} onChange={(v) => patchCurrent({ leaseTerm: v })} />
          </Field>
          <Field label="満了日" width={140}>
            <input
              type="date"
              value={quote.current.leaseEnd ?? ""}
              onChange={(e) => patchCurrent({ leaseEnd: e.target.value })}
            />
          </Field>
          <Field label="保守料金/月" width={120}>
            <NumberInput
              value={quote.current.maintenanceMonthly}
              onChange={(v) => patchCurrent({ maintenanceMonthly: v })}
            />
          </Field>
        </div>

        <h3>月間印刷枚数と現行カウンター単価</h3>
        <div className="row">
          <Field label="モノクロ枚数" width={120}>
            <NumberInput value={quote.current.monoPages} onChange={(v) => patchCurrent({ monoPages: v })} />
          </Field>
          <Field label="モノクロ単価" width={110}>
            <NumberInput step={0.01} value={quote.current.units.mono} onChange={(v) => patchUnits({ mono: v })} />
          </Field>
          <Field label="フルカラー枚数" width={120}>
            <NumberInput value={quote.current.colorPages} onChange={(v) => patchCurrent({ colorPages: v })} />
          </Field>
          <Field label="フルカラー単価" width={110}>
            <NumberInput step={0.01} value={quote.current.units.color} onChange={(v) => patchUnits({ color: v })} />
          </Field>
          <Field label="2色カラー枚数" width={120}>
            <NumberInput value={quote.current.twoColorPages} onChange={(v) => patchCurrent({ twoColorPages: v })} />
          </Field>
          <Field label="2色カラー単価" width={110}>
            <NumberInput step={0.01} value={quote.current.units.twoColor} onChange={(v) => patchUnits({ twoColor: v })} />
          </Field>
          <Field label="最低基本料金" width={110}>
            <NumberInput value={quote.current.units.minCharge} onChange={(v) => patchUnits({ minCharge: v })} />
          </Field>
        </div>

        <table style={{ marginTop: 12, maxWidth: 560 }}>
          <tbody>
            <tr><th>月間総印刷枚数</th><td className="num">{totalPages.toLocaleString()} 枚</td></tr>
            <tr><th>現行カウンター請求（月）</th><td className="num">{yen(current.counter.total)}</td></tr>
            <tr><th>現行 月間経費（税込）</th><td className="num">{yen(current.monthlyTotal)}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>提案の作成</h2>
        <p className="muted">
          月間総印刷枚数 {totalPages.toLocaleString()} 枚 →
          推奨グレードと仕切表から機種を自動選定し、エリアと印刷量からカウンター単価を自動判定します。
        </p>
        <div className="checks" style={{ marginBottom: 10 }}>
          {MAKERS.filter((m) => m !== "OTHER").map((m) => (
            <label key={m}>
              <input
                type="checkbox"
                checked={makers.includes(m)}
                onChange={(e) =>
                  setMakers((prev) => (e.target.checked ? [...prev, m] : prev.filter((x) => x !== m)))
                }
              />
              {MAKER_LABELS[m]}
            </label>
          ))}
        </div>
        <div className="row">
          <Field label="リース年数" width={120}>
            <select value={leaseTerm} onChange={(e) => setLeaseTerm(Number(e.target.value) as LeaseTerm)}>
              <option value={60}>5年（60回）</option>
              <option value={72}>6年（72回）</option>
              <option value={84}>7年（84回）</option>
            </select>
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={fetchSpec} onChange={(e) => setFetchSpec(e.target.checked)} />
            機種DBに無ければインターネットからスペックを取得
          </label>
          <button onClick={() => generateProposals(true)} disabled={!!busy}>
            提案を作り直す
          </button>
          <button className="secondary" onClick={() => generateProposals(false)} disabled={!!busy}>
            追加する
          </button>
        </div>
      </section>

      {quote.proposals.map((p) => {
        const calc = calcs.find((c) => c.proposal.id === p.id);
        return (
          <ProposalPanel
            key={p.id}
            proposal={p}
            calc={calc}
            book={book}
            settings={settings}
            onChange={(patch) => patchProposal(p.id, patch)}
            onRemove={() => removeProposal(p.id)}
          />
        );
      })}

      {calcs.length > 0 && (
        <section className="panel">
          <h2>比較サマリー</h2>
          <table>
            <thead>
              <tr>
                <th>メーカー</th>
                <th>機種</th>
                <th className="num">販売額計</th>
                <th className="num">月額リース</th>
                <th className="num">カウンター</th>
                <th className="num">月間経費(税込)</th>
                <th className="num">削減（単月）</th>
                <th className="num">削減（年間）</th>
                <th className="num">GP</th>
                <th className="num">PTF</th>
                <th className="num">NP</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>現行</td>
                <td>{quote.current.modelText || "－"}</td>
                <td className="num">－</td>
                <td className="num">{yen(current.monthlyLease)}</td>
                <td className="num">{yen(current.counter.total)}</td>
                <td className="num">{yen(current.monthlyTotal)}</td>
                <td className="num">－</td>
                <td className="num">－</td>
                <td className="num">－</td>
                <td className="num">－</td>
                <td className="num">－</td>
              </tr>
              {calcs.map((c) => (
                <tr key={c.proposal.id}>
                  <td>{MAKER_LABELS[c.proposal.maker]}</td>
                  <td>{c.proposal.modelText}</td>
                  <td className="num">{yen(c.sellingTotal)}</td>
                  <td className="num">{yen(c.monthlyLease)}</td>
                  <td className="num">{yen(c.counter.total)}</td>
                  <td className="num">{yen(c.monthlyTotal)}</td>
                  <td className={`num ${c.diffMonthly < 0 ? "save" : "cut"}`}>{sign(c.diffMonthly)}</td>
                  <td className={`num ${c.diffYearly < 0 ? "save" : "cut"}`}>{sign(c.diffYearly)}</td>
                  <td className="num">{yen(c.grossProfit)}</td>
                  <td className="num">{yen(c.ptf)}</td>
                  <td className="num">{yen(c.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">GP・PTF・NP は社内確認用です。お客様提出資料には出力されません（収益シートを選んだ場合を除く）。</p>
        </section>
      )}

      <section className="panel">
        <h2>見積書・比較表の出力</h2>
        <div className="row">
          <div className="checks">
            <label>
              <input
                type="checkbox"
                checked={docs.includes("quote")}
                onChange={(e) => setDocs((d) => (e.target.checked ? [...d, "quote"] : d.filter((x) => x !== "quote")))}
              />
              御見積書
            </label>
            <label>
              <input
                type="checkbox"
                checked={docs.includes("compare")}
                onChange={(e) =>
                  setDocs((d) => (e.target.checked ? [...d, "compare"] : d.filter((x) => x !== "compare")))
                }
              />
              比較表
            </label>
            <label>
              <input
                type="checkbox"
                checked={formats.includes("pdf")}
                onChange={(e) =>
                  setFormats((f) => (e.target.checked ? [...f, "pdf"] : f.filter((x) => x !== "pdf")))
                }
              />
              PDF
            </label>
            <label>
              <input
                type="checkbox"
                checked={formats.includes("xlsx")}
                onChange={(e) =>
                  setFormats((f) => (e.target.checked ? [...f, "xlsx"] : f.filter((x) => x !== "xlsx")))
                }
              />
              Excel
            </label>
            <label>
              <input type="checkbox" checked={includeProfit} onChange={(e) => setIncludeProfit(e.target.checked)} />
              収益シート（社内用）を含める
            </label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={exportFiles} disabled={!!busy || !quote.proposals.length}>
            選択したメーカー分をまとめて出力
          </button>
          {quote.proposals.map((p) => (
            <a
              key={p.id}
              className="badge"
              href={`/api/quotes/${quote.id}/preview?doc=quote&proposalId=${p.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {MAKER_LABELS[p.maker]} 見積書プレビュー
            </a>
          ))}
          {quote.proposals.map((p) => (
            <a
              key={`c-${p.id}`}
              className="badge"
              href={`/api/quotes/${quote.id}/preview?doc=compare&proposalId=${p.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {MAKER_LABELS[p.maker]} 比較表プレビュー
            </a>
          ))}
          {quote.proposals.length > 1 && (
            <a
              className="badge"
              href={`/api/quotes/${quote.id}/preview?doc=compare-all`}
              target="_blank"
              rel="noreferrer"
            >
              各社比較表プレビュー
            </a>
          )}
        </div>
        <p className="muted">
          複数ファイルになる場合は ZIP でダウンロードされます。PDF出力には Chromium が必要です
          （初回のみ <code>npx playwright install chromium</code>）。
        </p>
      </section>
    </>
  );
}

/* ---------------- 部品 ---------------- */

/** 保守対応エリアの検索と、ランクに応じた注意表示 */
function ServiceAreaPicker({
  value,
  area,
  onSelect,
}: {
  value?: { pref: string; city: string };
  area?: ServiceArea;
  onSelect: (area: ServiceArea) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ServiceArea[]>([]);
  const [searching, setSearching] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/service-areas?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      setHits(json.areas ?? []);
    } finally {
      setSearching(false);
    }
  }

  const sameDay = area?.rank === "S" || area?.rank === "A";
  const hard = area && !sameDay;

  return (
    <>
      <div className="row">
        <Field label="市区町村で検索" width={260}>
          <input value={query} onChange={(e) => search(e.target.value)} placeholder="久留米 / 福岡県 など" />
        </Field>
        <div className="field" style={{ minWidth: 260 }}>
          <label>選択中</label>
          <div>
            {value ? (
              <>
                {value.pref}
                {value.city}{" "}
                {area && (
                  <span
                    className="badge"
                    style={
                      sameDay
                        ? { background: "#e3f5e8", color: "#0a7d32" }
                        : { background: "#fdecef", color: "#b00020" }
                    }
                  >
                    ランク {area.rank}
                    {area.island ? ` / ${area.island}` : ""}
                  </span>
                )}
              </>
            ) : (
              <span className="muted">未選択（エリア判定なし）</span>
            )}
          </div>
        </div>
        {searching && <span className="spinner">検索中…</span>}
      </div>

      {hits.length > 0 && (
        <div className="checks" style={{ marginTop: 8 }}>
          {hits.slice(0, 24).map((a) => (
            <button
              key={`${a.pref}-${a.city}`}
              className="secondary"
              onClick={() => {
                onSelect(a);
                setHits([]);
                setQuery("");
              }}
            >
              {a.pref}
              {a.city}（{a.rank}
              {a.island ? `・${a.island}` : ""}）
            </button>
          ))}
        </div>
      )}

      {area && (
        <p className={hard ? "error" : "warn"} style={{ marginTop: 10 }}>
          {RANK_TEXT[area.rank]}
          {area.island ? ` ／ ${area.island}` : ""}
          {"\n"}
          {sameDay
            ? "当日保守が可能なエリアです。印刷枚数が少なくてもモノクロ0.7円／カラー7.0円までの単価が提示できます（京セラ）。"
            : area.rank === "D"
              ? "京セラの保守対応ができないエリアです。他メーカーでの提案をご検討ください。"
              : "当日保守ができないエリアです。カウンター単価が高くなりやすく、提案が難しいエリアです（自動判定はメーカーレンジの上限側になります）。"}
        </p>
      )}
      <p className="muted">
        収録しているのは京セラの担当エリア表です。単価の自動判定に反映されるのは京セラの提案のみで、
        他メーカーは参考情報としてご覧ください。
      </p>
    </>
  );
}

function Field({ label, width, children }: { label: string; width?: number; children: React.ReactNode }) {
  return (
    <div className="field" style={{ width }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      step={step ?? 1}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
    />
  );
}

function ProposalPanel({
  proposal,
  calc,
  book,
  settings,
  onChange,
  onRemove,
}: {
  proposal: Proposal;
  calc?: ProposalCalc;
  book: PriceBook | null;
  settings: Settings;
  onChange: (patch: Partial<Proposal>) => void;
  onRemove: () => void;
}) {
  const entries = book?.entries.filter((e) => e.maker === proposal.maker) ?? [];
  const note = book?.makerNotes?.[proposal.maker];

  function selectEntry(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    onChange({
      priceBookId: entry.id,
      modelText: entry.model,
      cost: entry.cost,
      items: entry.items.length
        ? entry.items.map((i) => ({ ...i }))
        : [{ name: `${entry.model}　一式`, qty: 1, unit: "式", unitPrice: entry.listPrice }],
    });
  }

  return (
    <section className="panel">
      <h2>
        提案：{MAKER_LABELS[proposal.maker]} {proposal.modelText && `／ ${proposal.modelText}`}
      </h2>
      <div className="row">
        <Field label="機種（仕切表）" width={280}>
          <select value={proposal.priceBookId ?? ""} onChange={(e) => selectEntry(e.target.value)}>
            <option value="">（選択してください）</option>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.model}
                {e.config ? `（${e.config}）` : ""} / {e.gradePpm}枚機 / 仕切 {e.cost.toLocaleString()}円
              </option>
            ))}
          </select>
        </Field>
        <Field label="仕切価格" width={130}>
          <NumberInput value={proposal.cost ?? 0} onChange={(v) => onChange({ cost: v })} />
        </Field>
        <Field label="価格の決め方" width={210}>
          <select
            value={proposal.pricingMode}
            onChange={(e) => onChange({ pricingMode: e.target.value as Proposal["pricingMode"] })}
          >
            <option value="fromMargin">仕切＋粗利率から算出</option>
            <option value="fromLease">目標の月額リース料から逆算</option>
            <option value="fromPrice">販売額計を直接入力</option>
          </select>
        </Field>
        {proposal.pricingMode === "fromMargin" && (
          <Field label="粗利率(%)" width={110}>
            <NumberInput
              step={0.1}
              value={Math.round((proposal.marginRate ?? settings.defaultMarginRate) * 1000) / 10}
              onChange={(v) => onChange({ marginRate: v / 100 })}
            />
          </Field>
        )}
        {proposal.pricingMode === "fromLease" && (
          <Field label="目標 月額リース料" width={150}>
            <NumberInput
              value={proposal.targetMonthlyLease ?? 0}
              onChange={(v) => onChange({ targetMonthlyLease: v })}
            />
          </Field>
        )}
        {proposal.pricingMode === "fromPrice" && (
          <Field label="販売額計" width={150}>
            <NumberInput value={proposal.sellingTotal ?? 0} onChange={(v) => onChange({ sellingTotal: v })} />
          </Field>
        )}
        <Field label="リース年数" width={130}>
          <select
            value={proposal.leaseTerm}
            onChange={(e) => onChange({ leaseTerm: Number(e.target.value) as LeaseTerm })}
          >
            <option value={60}>5年（60回）</option>
            <option value={72}>6年（72回）</option>
            <option value={84}>7年（84回）</option>
          </select>
        </Field>
        <Field label="保守料金/月" width={120}>
          <NumberInput
            value={proposal.maintenanceMonthly}
            onChange={(v) => onChange({ maintenanceMonthly: v })}
          />
        </Field>
        <button className="danger" onClick={onRemove}>
          削除
        </button>
      </div>

      <h3>
        カウンター単価{" "}
        <label style={{ fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={!proposal.counterOverridden}
            onChange={(e) =>
              onChange({
                counterOverridden: !e.target.checked,
                units: e.target.checked ? proposal.units : (calc?.units ?? proposal.units),
              })
            }
          />
          自動判定を使う
        </label>
        {note && (
          <span className="muted" style={{ marginLeft: 12 }}>
            {MAKER_LABELS[proposal.maker]}のレンジ：モノクロ {note.counterMono[0]}〜{note.counterMono[1]}円 / カラー{" "}
            {note.counterColor[0]}〜{note.counterColor[1]}円 ／ 最低基本料金{" "}
            {note.minCharge === null || note.minCharge === undefined
              ? "都度メーカー条件を確認して入力"
              : `${note.minCharge.toLocaleString()}円`}
          </span>
        )}
      </h3>
      {calc?.serviceWarning && <p className="error">{calc.serviceWarning}</p>}
      {calc?.minChargeNeedsInput && (
        <p className="warn">
          {MAKER_LABELS[proposal.maker]}は最低基本料金の条件が案件ごとに変わります。メーカー提示額を確認して入力してください。
        </p>
      )}
      <div className="row">
        <Field label="モノクロ" width={110}>
          <NumberInput
            step={0.01}
            value={proposal.counterOverridden ? (proposal.units?.mono ?? 0) : (calc?.units.mono ?? 0)}
            onChange={(v) => onChange({ units: { ...unitsOf(proposal, calc), mono: v }, counterOverridden: true })}
          />
        </Field>
        <Field label="フルカラー" width={110}>
          <NumberInput
            step={0.01}
            value={proposal.counterOverridden ? (proposal.units?.color ?? 0) : (calc?.units.color ?? 0)}
            onChange={(v) => onChange({ units: { ...unitsOf(proposal, calc), color: v }, counterOverridden: true })}
          />
        </Field>
        <Field label="2色カラー" width={110}>
          <NumberInput
            step={0.01}
            value={proposal.counterOverridden ? (proposal.units?.twoColor ?? 0) : (calc?.units.twoColor ?? 0)}
            onChange={(v) => onChange({ units: { ...unitsOf(proposal, calc), twoColor: v }, counterOverridden: true })}
          />
        </Field>
        <Field label="最低基本料金" width={120}>
          <NumberInput
            value={proposal.counterOverridden ? (proposal.units?.minCharge ?? 0) : (calc?.units.minCharge ?? 0)}
            onChange={(v) => onChange({ units: { ...unitsOf(proposal, calc), minCharge: v }, counterOverridden: true })}
          />
        </Field>
      </div>

      <h3>見積明細（定価）</h3>
      <p className="muted">
        フィニッシャー・ICカードリーダー等のオプションや追加のPC設定作業は「PTF対象外」にチェックを入れてください。
        その分は値引きせずに販売額へ上乗せし、PTFの計算対象から除きます。
      </p>
      <table>
        <thead>
          <tr>
            <th>品名・型番</th>
            <th style={{ width: 80 }}>数量</th>
            <th style={{ width: 70 }}>単位</th>
            <th style={{ width: 130 }} className="num">単価</th>
            <th style={{ width: 130 }} className="num">金額</th>
            <th style={{ width: 90 }}>PTF対象外</th>
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {proposal.items.map((item, i) => (
            <tr key={i}>
              <td>
                <input
                  style={{ width: "100%" }}
                  value={item.name}
                  onChange={(e) => updateItem(i, { name: e.target.value })}
                />
              </td>
              <td>
                <NumberInput value={item.qty} onChange={(v) => updateItem(i, { qty: v })} />
              </td>
              <td>
                <input style={{ width: "100%" }} value={item.unit} onChange={(e) => updateItem(i, { unit: e.target.value })} />
              </td>
              <td className="num">
                <NumberInput value={item.unitPrice} onChange={(v) => updateItem(i, { unitPrice: v })} />
              </td>
              <td className="num">{yen(item.qty * item.unitPrice)}</td>
              <td style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={!!item.ptfExempt}
                  onChange={(e) => updateItem(i, { ptfExempt: e.target.checked })}
                />
              </td>
              <td>
                <button className="danger" onClick={() => onChange({ items: proposal.items.filter((_, x) => x !== i) })}>
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
        onClick={() => onChange({ items: [...proposal.items, { name: "", qty: 1, unit: "台", unitPrice: 0 }] })}
      >
        明細を追加
      </button>

      {calc && (
        <>
          <h3>計算結果</h3>
          <div className="grid2">
            <table>
              <tbody>
                <tr><th>本体合計（定価）</th><td className="num">{yen(calc.listTotal)}</td></tr>
                <tr><th>お値引き</th><td className="num">{yen(calc.discount)}</td></tr>
                <tr><th>本体価格（PTF対象）</th><td className="num">{yen(calc.sellingBase)}</td></tr>
                {calc.addOnTotal > 0 && (
                  <tr>
                    <th>オプション等の上乗せ（PTF対象外）</th>
                    <td className="num">{yen(calc.addOnTotal)}</td>
                  </tr>
                )}
                <tr><th>販売額計（税抜）</th><td className="num">{yen(calc.sellingTotal)}</td></tr>
                <tr><th>月額リース料（{calc.proposal.leaseTerm}回）</th><td className="num">{yen(calc.monthlyLease)}</td></tr>
                <tr><th>カウンター請求（月）</th><td className="num">{yen(calc.counter.total)}</td></tr>
                <tr><th>月間経費（税込）</th><td className="num">{yen(calc.monthlyTotal)}</td></tr>
              </tbody>
            </table>
            <table>
              <tbody>
                <tr>
                  <th>削減額（単月）</th>
                  <td className={`num ${calc.diffMonthly < 0 ? "save" : "cut"}`}>{sign(calc.diffMonthly)}</td>
                </tr>
                <tr>
                  <th>削減額（年間）</th>
                  <td className={`num ${calc.diffYearly < 0 ? "save" : "cut"}`}>{sign(calc.diffYearly)}</td>
                </tr>
                <tr><th>仕切価格</th><td className="num">{yen(calc.cost)}</td></tr>
                <tr><th>GP（粗利益）</th><td className="num">{yen(calc.grossProfit)}</td></tr>
                <tr>
                  <th>PTF（本体価格の{Math.round(settings.ptf.rate * 100)}%）</th>
                  <td className="num">{yen(calc.ptf)}</td>
                </tr>
                <tr><th>NP（純利益）</th><td className="num">{yen(calc.netProfit)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="muted">
            リース料率：{(calc.leaseRate * 100).toFixed(2)}% ／ 5年 {yen(calc.leaseByTerm[60] ?? 0)}・6年{" "}
            {yen(calc.leaseByTerm[72] ?? 0)}・7年 {yen(calc.leaseByTerm[84] ?? 0)}
            {calc.device ? ` ／ スペック: ${calc.device.model}（取得元 ${calc.device.source.method}）` : " ／ スペック未登録"}
          </p>
        </>
      )}
    </section>
  );

  function updateItem(index: number, patch: Partial<Proposal["items"][number]>) {
    onChange({
      items: proposal.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
}

function unitsOf(proposal: Proposal, calc?: ProposalCalc) {
  return proposal.units ?? calc?.units ?? { mono: 0, color: 0, twoColor: 0, minCharge: 0 };
}
