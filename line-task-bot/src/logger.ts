/**
 * Cloud Logging が構造化ログとして解釈できる JSON を 1 行で吐く。
 * severity フィールドを見てログレベルが色分けされる。
 */

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

function emit(severity: Severity, message: string, fields?: unknown): void {
  const entry: Record<string, unknown> = { severity, message };
  if (fields && typeof fields === "object") {
    Object.assign(entry, fields);
  } else if (fields !== undefined) {
    entry.detail = fields;
  }
  const line = JSON.stringify(entry);
  if (severity === "ERROR" || severity === "WARNING") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

export const logger = {
  debug: (message: string, fields?: unknown) => emit("DEBUG", message, fields),
  info: (message: string, fields?: unknown) => emit("INFO", message, fields),
  warn: (message: string, fields?: unknown) => emit("WARNING", message, fields),
  error: (message: string, error?: unknown, fields?: unknown) =>
    emit("ERROR", message, {
      ...(typeof fields === "object" && fields !== null ? fields : {}),
      ...(error === undefined ? {} : serializeError(error)),
    }),
};
