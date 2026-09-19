import { ceilTo, leaseRateOf } from "./pricing";
import type {
  DeviceOption,
  DeviceSpec,
  OptionCalc,
  Proposal,
  ProposalDocSettings,
  Settings,
} from "./types";

/**
 * 提案資料（見積書・比較表とは別に出す、写真入りのご提案書）の計算。
 *
 * オプションは「付けた場合に月々いくら増えるか」だけをお客様に見せる。
 * 定価や販売額は資料に出さない。お客様が判断するのは月々の負担額であって、
 * 機器の値段ではないため。
 */

/**
 * オプションを付けた場合に増える月額リース料。
 *
 *   定価 × 掛け率（既定8掛け） × リース料率 を、月額リース料と同じ単位で切り上げる。
 *
 * 本体の月額リース料と同じ丸め方にしておかないと、
 * 「本体＋オプション」の合計が見積書の月額と合わなくなる。
 */
export function optionMonthlyLease(
  listPrice: number,
  leaseTerm: number,
  settings: Settings,
): { price: number; monthlyLeaseAdd: number } {
  const rate = settings.proposalDoc?.optionPriceRate ?? 0.8;
  const price = Math.max(0, Math.round(listPrice * rate));
  const leaseRate = leaseRateOf(leaseTerm, settings.leaseRates);
  return {
    price,
    monthlyLeaseAdd: ceilTo(price * leaseRate, settings.leaseRoundUnit ?? 1),
  };
}

/**
 * 提案資料に載せるオプションを組み立てる。
 * 提案で選んでいるオプションだけを、機種DBの並び順のまま返す。
 */
export function calcOptions(
  proposal: Proposal,
  device: DeviceSpec | undefined,
  settings: Settings,
): OptionCalc[] {
  const all = device?.options ?? [];
  const picked = proposal.optionIds?.length
    ? all.filter((o) => proposal.optionIds!.includes(o.id))
    : all;

  return picked.map((option) => ({
    option,
    ...optionMonthlyLease(option.listPrice, proposal.leaseTerm, settings),
  }));
}

/** 分類ごとにまとめる（提案資料で見出しを付けて並べるため） */
export function groupOptions(options: OptionCalc[]): { category: string; items: OptionCalc[] }[] {
  const groups = new Map<string, OptionCalc[]>();
  for (const o of options) {
    const key = o.option.category?.trim() || "オプション";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  return [...groups].map(([category, items]) => ({ category, items }));
}

/** 新しいオプションのID（機種DB内で一意であれば十分） */
export function newOptionId(): string {
  return `opt_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export const DEFAULT_PROPOSAL_DOC: ProposalDocSettings = {
  optionPriceRate: 0.8,
  title: "複合機 導入のご提案",
  lead:
    "このたびは貴重なお時間をいただき、誠にありがとうございます。\n" +
    "現在ご利用中の複合機の使用状況を拝見し、ご提案をまとめました。",
  highlights: [
    "月々のご負担を抑えながら、最新機種へ入れ替えられます",
    "保守は当日対応。トナー・保守部品もカウンター料金に含まれます",
    "使用枚数の実績にもとづいた、無理のない機種選定です",
  ],
};

/** 空のオプション（画面で行を足したときの初期値） */
export function emptyOption(): DeviceOption {
  return { id: newOptionId(), name: "", listPrice: 0 };
}
