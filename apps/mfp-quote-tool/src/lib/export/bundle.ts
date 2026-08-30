import JSZip from "jszip";
import type { Quote } from "../types";
import { MAKER_LABELS } from "../types";
import { calcQuoteAll, loadDocPhotos } from "../calc-context";
import { loadLogo } from "../logo";
import {
  renderCompareHtml,
  renderFleetCompareHtml,
  renderMultiCompareHtml,
  renderProposalDocHtml,
  renderQuoteHtml,
} from "./html";
import { htmlToPdf, PdfUnavailableError } from "./pdf";
import {
  addFleetSheet,
  addMultiCompareSheet,
  addProfitSheet,
  addQuoteSheet,
  newWorkbook,
  putLogo,
  workbookToBuffer,
} from "./excel";

export type DocKind = "quote" | "compare" | "proposal";
export type Format = "pdf" | "xlsx";

export interface ExportRequest {
  /** 出力対象の提案ID（未指定なら全提案） */
  proposalIds?: string[];
  docs: DocKind[];
  formats: Format[];
  /** 社内用の収益シートを含めるか */
  includeProfit?: boolean;
}

export interface ExportedFile {
  name: string;
  buffer: Buffer;
  contentType: string;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, "_").trim();

/**
 * 見積書・比較表を指定形式で書き出す。
 * 複数メーカーを選んだ場合はメーカーごとにファイルを作り、
 * Excel は1ブックにメーカー別シートとしてまとめる。
 */
export async function buildExports(quote: Quote, req: ExportRequest): Promise<{
  files: ExportedFile[];
  warnings: string[];
}> {
  const { settings, current, proposals, fleet } = await calcQuoteAll(quote);
  const logo = await loadLogo();
  const targets = req.proposalIds?.length
    ? proposals.filter((p) => req.proposalIds!.includes(p.proposal.id))
    : proposals;

  const files: ExportedFile[] = [];
  const warnings: string[] = [];
  const base = safe(`${quote.quoteDate}_${quote.customerName}`);
  // 複合機が複数台ある案件は、A3ヨコ1枚の複数台比較表も出す
  const withFleet = fleet && quote.fleet && req.docs.includes("compare") ? { fleet, input: quote.fleet } : undefined;

  // ── Excel（1ブックにメーカー別シート）
  if (req.formats.includes("xlsx") && (targets.length || withFleet)) {
    const wb = newWorkbook(settings.company.name);
    for (const calc of targets) {
      putLogo(wb, addQuoteSheet(wb, quote, current, calc, settings), logo);
    }
    if (targets.length > 1 && req.docs.includes("compare")) {
      putLogo(wb, addMultiCompareSheet(wb, quote, current, targets), logo);
    }
    if (withFleet) {
      putLogo(wb, addFleetSheet(wb, quote, withFleet.input, withFleet.fleet, settings), logo);
    }
    if (req.includeProfit) addProfitSheet(wb, targets);
    files.push({
      name: `${base}_御見積書・比較表.xlsx`,
      buffer: await workbookToBuffer(wb),
      contentType: XLSX_MIME,
    });
  }

  // ── PDF（帳票ごと・メーカーごと）
  if (req.formats.includes("pdf")) {
    try {
      for (const calc of targets) {
        const maker = MAKER_LABELS[calc.proposal.maker];
        if (req.docs.includes("quote")) {
          files.push({
            name: `${base}_御見積書_${safe(maker)}.pdf`,
            buffer: await htmlToPdf(renderQuoteHtml(quote, calc, settings, logo?.dataUri)),
            contentType: "application/pdf",
          });
        }
        if (req.docs.includes("compare")) {
          files.push({
            name: `${base}_比較表_${safe(maker)}.pdf`,
            // 比較表は必ず1枚に収める（並べて見比べる紙なので、切れると使えない）
            buffer: await htmlToPdf(renderCompareHtml(quote, current, calc, settings, logo?.dataUri), {
              fitOnePage: true,
            }),
            contentType: "application/pdf",
          });
        }
        if (req.docs.includes("proposal")) {
          const photos = await loadDocPhotos(quote, calc);
          files.push({
            name: `${base}_ご提案書_${safe(maker)}.pdf`,
            buffer: await htmlToPdf(
              renderProposalDocHtml(quote, current, calc, settings, photos, logo?.dataUri),
            ),
            contentType: "application/pdf",
          });
        }
      }
      if (targets.length > 1 && req.docs.includes("compare")) {
        files.push({
          name: `${base}_比較表_各社.pdf`,
          buffer: await htmlToPdf(renderMultiCompareHtml(quote, current, targets, settings, logo?.dataUri), {
            fitOnePage: true,
          }),
          contentType: "application/pdf",
        });
      }
      if (withFleet) {
        files.push({
          name: `${base}_複数台比較表.pdf`,
          buffer: await htmlToPdf(
            renderFleetCompareHtml(quote, withFleet.input, withFleet.fleet, settings, logo?.dataUri),
            { format: "A3", landscape: true, fitOnePage: true },
          ),
          contentType: "application/pdf",
        });
      }
    } catch (err) {
      if (err instanceof PdfUnavailableError) warnings.push(err.message);
      else throw err;
    }
  }

  return { files, warnings };
}

/** 複数ファイルをZIPにまとめる */
export async function zipFiles(files: ExportedFile[], zipName: string): Promise<ExportedFile> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.buffer);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { name: zipName, buffer, contentType: "application/zip" };
}
