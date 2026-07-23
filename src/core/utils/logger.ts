type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const ctxStr = context ? ` ${JSON.stringify(context)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${ctxStr}`;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(this.formatMessage("debug", message, context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.info(this.formatMessage("info", message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(this.formatMessage("warn", message, context));
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const errCtx = error instanceof Error ? { ...context, error: error.message, stack: error.stack } : context;
    console.error(this.formatMessage("error", message, errCtx));
  }
}

export const logger = new Logger();
