"use client";

import type { IngestProgress } from "@/lib/ingest";

/**
 * 解析の進み具合を受け取りながら資料を送る。
 *
 * ふつうの fetch は終わるまで何も返ってこないので、何十枚も読ませると
 * 画面が固まったように見える。1行1件のJSON（NDJSON）で流れてくる
 * 途中経過を読みながら、最後の1行を結果として返す。
 */
export async function postWithProgress<T>(
  url: string,
  body: FormData,
  onProgress: (progress: IngestProgress) => void,
): Promise<T> {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}stream=1`, {
    method: "POST",
    body,
  });
  if (!res.ok || !res.body) {
    // 途中経過つきで受け取れない場合は、そのままエラーとして扱う
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "解析に失敗しました。");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as
      | { type: "progress"; progress: IngestProgress }
      | { type: "result"; result: T }
      | { type: "error"; error: string };
    if (event.type === "progress") onProgress(event.progress);
    else if (event.type === "result") result = event.result;
    else throw new Error(event.error);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 改行で区切って、最後の未完成な断片だけ残す
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(buffer);

  if (result === undefined) throw new Error("解析の結果を受け取れませんでした。");
  return result;
}
