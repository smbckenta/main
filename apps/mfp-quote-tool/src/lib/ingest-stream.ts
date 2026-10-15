import type { IngestProgress } from "./ingest";

/**
 * 解析の進み具合を、終わるのを待たずに画面へ流すための入れ物。
 *
 * 資料が何十枚もあると解析に数分かかる。その間ずっと画面が黙っていると
 * 固まったように見えてしまうので、1行1件のJSON（NDJSON）で
 * 「何ファイル目を、いま何をしているか」を送り続け、最後に結果を送る。
 *
 * 途中経過と結果を同じ流れで送るため、受け取る側は最後の1行だけを
 * 結果として扱えばよい。
 */

export type IngestEvent =
  | { type: "progress"; progress: IngestProgress }
  | { type: "result"; result: unknown }
  | { type: "error"; error: string };

/** 1行1件のJSONで流す応答を作る */
export function ndjsonResponse(
  run: (emit: (event: IngestEvent) => void) => Promise<unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: IngestEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await run(send);
        send({ type: "result", result });
      } catch (err) {
        send({ type: "error", error: (err as Error).message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // 途中経過をためこまずにそのまま流す（プロキシ対策）
      "X-Accel-Buffering": "no",
    },
  });
}
