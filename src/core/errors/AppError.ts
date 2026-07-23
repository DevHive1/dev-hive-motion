export enum ErrorCode {
  // Validation
  INVALID_COMPOSITION = "INVALID_COMPOSITION",
  INVALID_SCENE_ID = "INVALID_SCENE_ID",
  INVALID_ELEMENT_ID = "INVALID_ELEMENT_ID",

  // Agent
  AGENT_TIMEOUT = "AGENT_TIMEOUT",
  AGENT_MAX_ITERATIONS = "AGENT_MAX_ITERATIONS",
  TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",

  // Render
  RENDER_BUNDLE_FAILED = "RENDER_BUNDLE_FAILED",
  RENDER_MEDIA_FAILED = "RENDER_MEDIA_FAILED",

  // Provider
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",
  PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED",
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}
