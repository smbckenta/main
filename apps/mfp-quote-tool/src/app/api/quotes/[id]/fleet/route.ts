import { NextResponse } from "next/server";
import { calcQuoteAll } from "@/lib/calc-context";
import { autoSelectProposals, hasFleet, type AutoSelectContext } from "@/lib/fleet";
import { autoCounterUnits } from "@/lib/pricing";
import { lookupPhoto, lookupSpec } from "@/lib/specs/lookup";
import { findDeviceByModel, getPriceBook, getQuote, getSettings, saveQuote } from "@/lib/store";
import type { Fleet, Maker, Quote } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * 複数台の案件で、全台に提案機種を自動で入れる。
 *
 * 全台の合計枚数から1台だけを選ぶのは実態に合わない。台はそれぞれの
 * 設置場所に置くものなので、台ごとに現行と同等以上の機種を選び、
 * 台数ぶんそのまま提案する。
 *
 * 現行機の印刷速度は、明細には載っていないことが多い。
 * ここで機種DB（無ければメーカーのサイト）から引いて、
 * 「現行と同等以上」の判定に使う。引いた結果はDBに残るので、
 * 2回目からはインターネットに出ない。
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const saved0 = await getQuote(id);
  if (!saved0) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  const body = (await req.json()) as { maker: Maker; fetchSpec?: boolean; fleet?: Fleet };
  if (!body.maker) return NextResponse.json({ error: "メーカーを選択してください。" }, { status: 400 });

  // 画面で台を足した直後（まだ保存していない状態）でも押せるよう、
  // 画面が持っている台をそのまま受け取る
  const quote: Quote = body.fleet ? { ...saved0, fleet: body.fleet } : saved0;
  if (!hasFleet(quote.fleet)) {
    return NextResponse.json({ error: "複数台の台が登録されていません。" }, { status: 400 });
  }

  const [settings, book] = await Promise.all([getSettings(), getPriceBook()]);
  const makerNote = book.makerNotes[body.maker];
  const messages: string[] = [];

  const ctx: AutoSelectContext = { currentPpm: {}, counterUnits: {} };
  for (const unit of quote.fleet.units) {
    // 現行機の印刷速度
    const ppm = await currentPpmOf(unit.current.modelText, Boolean(body.fetchSpec));
    if (ppm) ctx.currentPpm![unit.id] = ppm;

    // 提案のカウンター単価は、その台の枚数とエリアから判定する
    ctx.counterUnits![unit.id] = autoCounterUnits(
      settings,
      unitAsQuote(quote, unit.current.lines),
      body.maker,
      makerNote,
      // 判定に使う「現行のカウンター請求額」はその台の分だけ
      (unit.current.lines ?? []).reduce((sum, l) => sum + l.pages * (l.tiers[0]?.unit ?? 0), 0),
    );
  }

  const fleet = autoSelectProposals(quote.fleet, body.maker, book, settings, ctx);
  const chosen = [...new Set(fleet.units.map((u) => u.proposal.modelText).filter(Boolean))];
  if (!chosen.length) {
    return NextResponse.json(
      { error: `${body.maker} の機種が仕切表に登録されていません。仕切表画面から登録してください。` },
      { status: 400 },
    );
  }

  // 提案機種の筐体写真も用意しておく（提案資料に使う）。
  // すでに機種DBにある機種は取りに行かないので、同じ機種を何度提案しても
  // インターネットに出るのは最初の1回だけ。
  const photos: string[] = [];
  for (const model of chosen) {
    const result = await lookupPhoto(model, body.maker);
    if (result.origin === "web" && result.photo) photos.push(model);
  }
  if (photos.length) messages.push(`${photos.join("・")} の写真を取得し、機種DBに保存しました。`);

  const saved = await saveQuote({ ...quote, fleet });
  return NextResponse.json({
    quote: saved,
    ...(await calcQuoteAll(saved)),
    messages: [`全${fleet.units.length}台に ${chosen.join("・")} を入れました。`, ...messages],
  });
}

/**
 * 現行機の印刷速度を調べる。
 * 機種DBにあればそれを使い、無ければ（指定されたときだけ）メーカーのサイトを見る。
 */
async function currentPpmOf(model: string, fetchSpec: boolean): Promise<number | undefined> {
  const clean = model.trim();
  if (!clean) return undefined;
  const cached = await findDeviceByModel(clean);
  const ppmOf = (d?: { ppmColor?: number; ppmMono?: number }) => d?.ppmColor ?? d?.ppmMono;
  if (cached) return ppmOf(cached);
  if (!fetchSpec) return undefined;
  const looked = await lookupSpec(clean);
  return ppmOf(looked.device);
}

/**
 * カウンター単価の自動判定は案件（Quote）を見る作りなので、
 * その台の枚数だけを入れた案件の形にして渡す。
 */
function unitAsQuote(quote: Quote, lines: Quote["current"]["chargeLines"]): Quote {
  const pagesOf = (kind: string) =>
    (lines ?? []).filter((l) => l.kind === kind).reduce((sum, l) => sum + l.pages, 0);
  return {
    ...quote,
    current: {
      ...quote.current,
      monoPages: pagesOf("mono"),
      colorPages: pagesOf("color"),
      twoColorPages: pagesOf("twoColor"),
      chargeLines: undefined,
    },
  };
}
