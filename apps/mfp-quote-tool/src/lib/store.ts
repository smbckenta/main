import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DeviceSpec, PriceBook, PriceBookEntry, Quote, Settings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";

/**
 * JSONファイルによる簡易ストア。
 * 外部DBを立てずに済み、機種DB・仕切表をGitで共有できることを優先している。
 */

/** アプリに同梱しているマスタ（仕切表・機種DB・保守エリア・OCR辞書） */
const BUNDLED_DATA_DIR = path.join(process.cwd(), "data");

/**
 * データの保存先。
 * MFP_DATA_DIR を指定すると、案件・設定に加えてマスタもそこへ置く。
 * Googleドライブの共有フォルダを指定すれば、複数のPCで同じデータを使える。
 */
export const DATA_DIR = process.env.MFP_DATA_DIR
  ? path.resolve(process.env.MFP_DATA_DIR)
  : BUNDLED_DATA_DIR;

/** 保存先に無いマスタを同梱データから配置する（初回のみ） */
const SEED_ENTRIES = ["price-book.json", "devices.json", "service-areas.json", "tessdata"];
let seedPromise: Promise<void> | null = null;

export function ensureDataDir(): Promise<void> {
  if (DATA_DIR === BUNDLED_DATA_DIR) return Promise.resolve();
  seedPromise ??= (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    for (const entry of SEED_ENTRIES) {
      const target = path.join(DATA_DIR, entry);
      try {
        await fs.access(target);
      } catch {
        const source = path.join(BUNDLED_DATA_DIR, entry);
        await fs.cp(source, target, { recursive: true }).catch(() => {
          /* 同梱データが無い場合は何もしない */
        });
      }
    }
  })();
  return seedPromise;
}

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const DEVICES_FILE = path.join(DATA_DIR, "devices.json");
const PRICEBOOK_FILE = path.join(DATA_DIR, "price-book.json");
const QUOTES_DIR = path.join(DATA_DIR, "quotes");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  await ensureDataDir();
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

/** 書き込み途中で壊れないよう一時ファイル経由で置き換える */
async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDataDir();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/* ---------------- 設定 ---------------- */

export async function getSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings> | null>(SETTINGS_FILE, null);
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  // 設定項目が増えても既存ファイルで動くようマージする
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    company: { ...DEFAULT_SETTINGS.company, ...(stored.company ?? {}) },
    leaseRates: stored.leaseRates ?? DEFAULT_SETTINGS.leaseRates,
    ptf: {
      ...DEFAULT_SETTINGS.ptf,
      ...(stored.ptf ?? {}),
      counter: { ...DEFAULT_SETTINGS.ptf.counter, ...(stored.ptf?.counter ?? {}) },
    },
  };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  await writeJson(SETTINGS_FILE, settings);
  return settings;
}

/* ---------------- 仕切表 ---------------- */

const EMPTY_PRICEBOOK: PriceBook = {
  version: "",
  source: "",
  entries: [],
  makerNotes: {},
};

export async function getPriceBook(): Promise<PriceBook> {
  return readJson<PriceBook>(PRICEBOOK_FILE, EMPTY_PRICEBOOK);
}

export async function savePriceBook(book: PriceBook): Promise<PriceBook> {
  await writeJson(PRICEBOOK_FILE, book);
  return book;
}

export async function upsertPriceBookEntry(entry: PriceBookEntry): Promise<PriceBookEntry> {
  const book = await getPriceBook();
  const idx = book.entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) book.entries[idx] = entry;
  else book.entries.push(entry);
  await savePriceBook(book);
  return entry;
}

export async function deletePriceBookEntry(id: string): Promise<void> {
  const book = await getPriceBook();
  book.entries = book.entries.filter((e) => e.id !== id);
  await savePriceBook(book);
}

/* ---------------- 機種スペックDB ---------------- */

export async function listDevices(): Promise<DeviceSpec[]> {
  return readJson<DeviceSpec[]>(DEVICES_FILE, []);
}

export async function deviceMap(): Promise<Record<string, DeviceSpec>> {
  return Object.fromEntries((await listDevices()).map((d) => [d.id, d]));
}

/** 型番の表記ゆれを吸収するキー（英数字のみ・大文字化） */
export function modelKey(model: string): string {
  return model
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export async function findDeviceByModel(model: string): Promise<DeviceSpec | undefined> {
  const key = modelKey(model);
  if (key.length < 3) return undefined;
  const list = await listDevices();
  return (
    list.find((d) => modelKey(d.model) === key) ??
    list.find((d) => {
      const k = modelKey(d.model);
      return k.length >= 5 && (k.includes(key) || key.includes(k));
    })
  );
}

export async function upsertDevice(
  device: Omit<DeviceSpec, "id" | "updatedAt"> & { id?: string },
): Promise<DeviceSpec> {
  const list = await listDevices();
  const key = modelKey(device.model);
  const idx = list.findIndex((d) =>
    device.id ? d.id === device.id : modelKey(d.model) === key && d.maker === device.maker,
  );
  const record: DeviceSpec = {
    ...(device as DeviceSpec),
    id: device.id ?? (idx >= 0 ? list[idx].id : randomUUID()),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...record };
  else list.push(record);
  list.sort((a, b) => a.maker.localeCompare(b.maker) || a.model.localeCompare(b.model));
  await writeJson(DEVICES_FILE, list);
  return record;
}

export async function deleteDevice(id: string): Promise<void> {
  await writeJson(DEVICES_FILE, (await listDevices()).filter((d) => d.id !== id));
}

/* ---------------- 案件 ---------------- */

export async function listQuotes(): Promise<Quote[]> {
  await ensureDataDir();
  await fs.mkdir(QUOTES_DIR, { recursive: true });
  const files = (await fs.readdir(QUOTES_DIR)).filter((f) => f.endsWith(".json"));
  const quotes = await Promise.all(
    files.map((f) => readJson<Quote | null>(path.join(QUOTES_DIR, f), null)),
  );
  return quotes
    .filter((q): q is Quote => q !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getQuote(id: string): Promise<Quote | undefined> {
  return (await readJson<Quote | null>(path.join(QUOTES_DIR, `${id}.json`), null)) ?? undefined;
}

export async function saveQuote(quote: Quote): Promise<Quote> {
  const record = { ...quote, updatedAt: new Date().toISOString() };
  await writeJson(path.join(QUOTES_DIR, `${record.id}.json`), record);
  return record;
}

export async function deleteQuote(id: string): Promise<void> {
  await fs.rm(path.join(QUOTES_DIR, `${id}.json`), { force: true });
}

export function newId(): string {
  return randomUUID();
}

/** 見積書番号（既存Excelは連番運用のため、最終番号+1を返す） */
export async function nextQuoteNo(): Promise<string> {
  const quotes = await listQuotes();
  const numbers = quotes
    .map((q) => Number(String(q.quoteNo).replace(/[^0-9]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const base = numbers.length ? Math.max(...numbers) : 136000;
  return String(base + 1);
}
