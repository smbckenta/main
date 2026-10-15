"use client";

import type { IngestProgress } from "@/lib/ingest";

/**
 * 解析中の進み具合。
 *
 * 「何ファイル目まで終わったか」が見えないと、時間のかかる解析を
 * 止まったものと勘違いして閉じてしまう。ファイル名といまの作業まで
 * 出して、動いていることが一目で分かるようにする。
 */
export default function IngestProgressBar({ progress }: { progress: IngestProgress | null }) {
  if (!progress) return null;

  const { index, total, completed, name, phase, message } = progress;
  // 「いま処理中のファイル」も途中まで進んだものとして数える（バーが止まって見えないように）
  const ratio = total > 0 ? Math.min(1, (completed + (phase === "done" ? 0 : 0.5)) / total) : 0;

  return (
    <div className="ingest-progress">
      <div className="ingest-progress-head">
        <strong>
          {total}件中 {index}件目を解析しています
        </strong>
        <span className="muted">（読み取り済み {completed}件）</span>
      </div>
      <div className="ingest-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
        <div className="ingest-bar-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="ingest-progress-file" title={message}>
        {name}　<span className="muted">{PHASE_TEXT[phase]}</span>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
        写真やスキャンPDFは1ファイルに数十秒かかることがあります。この画面のままお待ちください。
      </p>
    </div>
  );
}

const PHASE_TEXT: Record<IngestProgress["phase"], string> = {
  start: "準備しています…",
  extract: "ファイルを開いています…",
  ai: "AIで読み取っています…",
  ocr: "文字起こし（OCR）で読み取っています…",
  parse: "読み取った内容を整理しています…",
  done: "読み取り完了",
};
