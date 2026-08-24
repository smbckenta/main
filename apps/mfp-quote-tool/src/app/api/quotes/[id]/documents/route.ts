import { NextResponse } from "next/server";
import { getQuote, saveQuote } from "@/lib/store";
import { calcQuoteAll } from "@/lib/calc-context";
import { ingestDocuments, type DocRole } from "@/lib/ingest";
import { saveUpload } from "@/lib/uploads";
import type { CurrentMachine, Quote } from "@/lib/types";

export const runtime = "nodejs";
// 写真・スキャンPDFの読み取りは1ページ数秒かかるため長めに取る
export const maxDuration = 600;

type Ctx = { params: Promise<{ id: string }> };

/**
 * 読み取り結果を現行機に取り込む。
 *
 * 読めた項目だけを上書きし、読めなかった項目は今の値を残す。
 * せっかく手で直した内容が、追加の資料を読ませただけで消えると困るため。
 */
function mergeCurrent(now: CurrentMachine, read: CurrentMachine): CurrentMachine {
  const merged: CurrentMachine = { ...now };
  const text = (a: string, b: string) => (b.trim() ? b : a);
  const num = (a: number, b: number) => (b > 0 ? b : a);

  merged.makerText = text(now.makerText, read.makerText);
  merged.modelText = text(now.modelText, read.modelText);
  merged.monthlyLease = num(now.monthlyLease, read.monthlyLease);
  merged.leaseTerm = read.leaseTerm ?? now.leaseTerm;
  merged.leaseStart = read.leaseStart ?? now.leaseStart;
  merged.leaseEnd = read.leaseEnd ?? now.leaseEnd;
  merged.remainingDebt = read.remainingDebt ?? now.remainingDebt;
  merged.monoPages = num(now.monoPages, read.monoPages);
  merged.colorPages = num(now.colorPages, read.colorPages);
  merged.twoColorPages = num(now.twoColorPages, read.twoColorPages);
  merged.pagesPeriod = read.pagesPeriod ?? now.pagesPeriod;
  merged.deductionRate = read.deductionRate ?? now.deductionRate;
  if (read.chargeLines?.length) merged.chargeLines = read.chargeLines;
  merged.units = {
    mono: num(now.units.mono, read.units.mono),
    color: num(now.units.color, read.units.color),
    twoColor: num(now.units.twoColor, read.units.twoColor),
    minCharge: now.units.minCharge,
  };
  // リース料が読めたなら「不明」は外れる
  if (read.monthlyLease > 0) merged.leaseUnknown = false;
  return merged;
}

/** 案件に資料を追加で読み取らせ、現行機に反映する */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  const form = await req.formData();
  const entries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!entries.length) {
    return NextResponse.json({ error: "ファイルが指定されていません。" }, { status: 400 });
  }
  const roles = form.getAll("roles").map((r) => String(r) as DocRole);

  // mode=store は「読み取りはもう済んでいるので、原本だけ残す」。
  // 新規作成の画面は先に解析してから案件を作るので、
  // ここでAIをもう一度走らせると料金も時間も二重にかかる。
  if (form.get("mode") === "store") {
    const files = [...(quote.ingest?.files ?? [])];
    for (const file of entries) {
      const stored = await saveUpload(id, file.name, Buffer.from(await file.arrayBuffer()));
      const at = files.findIndex((f) => f.name === file.name && !f.file);
      if (at >= 0) files[at] = { ...files[at], file: stored };
      else if (stored) {
        files.push({
          name: file.name,
          kind: file.type || "unknown",
          role: "unknown",
          parsedAt: new Date().toISOString(),
          file: stored,
        });
      }
    }
    const saved = await saveQuote({
      ...quote,
      ingest: {
        counter: quote.ingest?.counter ?? [],
        lease: quote.ingest?.lease ?? [],
        warnings: quote.ingest?.warnings ?? [],
        files,
      },
    });
    return NextResponse.json({ quote: saved });
  }

  const inputs = await Promise.all(
    entries.map(async (file, i) => ({
      name: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
      role: roles[i],
    })),
  );

  try {
    const result = await ingestDocuments(inputs);

    // 読み取ったファイルそのものを案件に残す（あとで原本を開き直せるように）
    const stored = await Promise.all(
      inputs.map(async (input, i) => ({
        ...result.files[i],
        name: input.name,
        file: await saveUpload(id, input.name, input.buffer),
      })),
    );

    const saved = await saveQuote({
      ...quote,
      current: mergeCurrent(quote.current, result.current),
      ingest: {
        counter: [...(quote.ingest?.counter ?? []), ...result.counter],
        lease: [...(quote.ingest?.lease ?? []), ...result.lease],
        files: [...(quote.ingest?.files ?? []), ...stored],
        warnings: result.warnings,
      },
    } as Quote);

    const calc = await calcQuoteAll(saved);
    return NextResponse.json({ quote: saved, ...calc, ingest: result });
  } catch (err) {
    return NextResponse.json(
      { error: `解析に失敗しました: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
