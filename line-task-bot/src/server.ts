/** Express アプリの組み立て。Cloud Run が待ち受ける HTTP 面。 */

import express, { type Request, type Response } from "express";
import { validateSignature, type WebhookEvent } from "@line/bot-sdk";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { handleEvents } from "./line/webhook.js";
import { runAnalyze } from "./jobs/analyze.js";
import { runReminders } from "./jobs/reminders.js";
import { runDigest } from "./jobs/digest.js";
import { ensureTasksSheet } from "./store/taskRepo.js";
import { ensureMessagesSheet } from "./store/messageRepo.js";
import { ensureActionsSheet } from "./store/actionRepo.js";

export function createApp(): express.Express {
  const app = express();

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).send("ok");
  });

  // 署名検証には生のリクエストボディが必要。JSON パーサより前に raw で受ける。
  app.post(
    "/line/webhook",
    express.raw({ type: "*/*", limit: "2mb" }),
    handleWebhook,
  );

  app.use(express.json());

  app.post("/jobs/analyze", jobHandler("analyze", async (req) => {
    const groupId =
      typeof req.body?.groupId === "string" ? req.body.groupId : undefined;
    const results = await runAnalyze({ groupId });
    return {
      groups: results.length,
      created: results.reduce((sum, r) => sum + r.createdTasks.length, 0),
      updated: results.reduce((sum, r) => sum + r.updatedTasks, 0),
    };
  }));

  app.post("/jobs/reminders", jobHandler("reminders", async () => {
    const results = await runReminders();
    return {
      groups: results.length,
      reminded: results.reduce((sum, r) => sum + r.reminded, 0),
    };
  }));

  app.post("/jobs/digest", jobHandler("digest", async () => {
    const results = await runDigest();
    return { groups: results.length };
  }));

  // シートの初期化。デプロイ後に一度だけ叩く。
  app.post("/admin/bootstrap", jobHandler("bootstrap", async () => {
    await ensureTasksSheet();
    await ensureMessagesSheet();
    await ensureActionsSheet();
    return { ok: true };
  }));

  return app;
}

async function handleWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.get("x-line-signature");
  const body = req.body as Buffer;

  if (!signature || !Buffer.isBuffer(body)) {
    res.status(400).send("missing signature or body");
    return;
  }

  if (!validateSignature(body, config.line.channelSecret, signature)) {
    logger.warn("署名検証に失敗しました");
    res.status(401).send("invalid signature");
    return;
  }

  let events: WebhookEvent[];
  try {
    events = (JSON.parse(body.toString("utf8")) as { events?: WebhookEvent[] })
      .events ?? [];
  } catch (error) {
    logger.error("webhook ボディの解析に失敗しました", error);
    res.status(400).send("invalid body");
    return;
  }

  // LINE 側のタイムアウトを避けるため、処理を待ってから 200 を返す。
  // 各ハンドラは軽い処理に限定してあるので、これで間に合う。
  await handleEvents(events);
  res.status(200).send("ok");
}

/**
 * Cloud Scheduler から叩かれるジョブ用の共通ハンドラ。
 * JOB_SECRET が設定されていれば x-job-secret ヘッダを検証する
 * （Cloud Scheduler の OIDC 認証と併用する多層防御）。
 */
function jobHandler(
  name: string,
  run: (req: Request) => Promise<unknown>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    if (config.jobs.secret && req.get("x-job-secret") !== config.jobs.secret) {
      res.status(401).send("unauthorized");
      return;
    }
    try {
      const result = await run(req);
      logger.info(`ジョブが完了しました: ${name}`, result);
      res.status(200).json(result);
    } catch (error) {
      logger.error(`ジョブが失敗しました: ${name}`, error);
      res.status(500).json({ error: "job failed" });
    }
  };
}
