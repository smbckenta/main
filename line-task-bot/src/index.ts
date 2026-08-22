import { config } from "./config.js";
import { logger } from "./logger.js";
import { createApp } from "./server.js";

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info("サーバーを起動しました", {
    port: config.port,
    model: config.anthropic.model,
    timezone: config.behavior.timezone,
    autoExecuteMaxRisk: config.behavior.autoExecuteMaxRisk,
  });
});

// Cloud Run はコンテナ停止時に SIGTERM を送る。処理中のリクエストを取りこぼさないよう待つ。
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info("シャットダウンします", { signal });
    server.close(() => process.exit(0));
  });
}
