import type { AppErrorInfo, ErrorCode, RecoveryAction } from './types';

interface ErrorSpec {
  message: string;
  recovery: RecoveryAction;
}

/** User-facing message and recovery action for every diagnostic code. */
export const ERROR_CATALOG: Record<ErrorCode, ErrorSpec> = {
  E_MODEL_DOWNLOAD: { message: 'The voice model could not be downloaded. Check your connection and try again.', recovery: 'retry-download' },
  E_MODEL_INTEGRITY: { message: 'The downloaded model failed its integrity check and was discarded. Download it again.', recovery: 'retry-download' },
  E_MODEL_INIT: { message: 'The voice model could not start on this device.', recovery: 'use-wasm' },
  E_WEBGPU_UNAVAILABLE: { message: 'WebGPU is not available here, so Kokoro is using the CPU (WebAssembly) engine.', recovery: 'none' },
  E_WASM_FAILED: { message: 'The WebAssembly engine failed to start. Restart Chrome and try again.', recovery: 'retry' },
  E_OUT_OF_MEMORY: { message: 'The device ran out of memory while running the model. Close some tabs or pick the smaller 8-bit model.', recovery: 'open-settings' },
  E_STORAGE_QUOTA: { message: 'There is not enough storage space for the voice model. Free some disk space and retry.', recovery: 'clear-cache' },
  E_OFFLINE: { message: 'You are offline, and the voice model has not been downloaded yet.', recovery: 'retry-download' },
  E_SYNTHESIS: { message: 'Speech could not be generated for this text.', recovery: 'retry' },
  E_PLAYBACK: { message: 'Audio playback failed.', recovery: 'retry' },
  E_WORKER_CRASHED: { message: 'The speech engine stopped unexpectedly and has been restarted.', recovery: 'retry' },
  E_EMPTY_TEXT: { message: 'There is no readable text here. Select some text first.', recovery: 'select-text' },
  E_UNSUPPORTED_PAGE: { message: 'Chrome does not let extensions read this page (for example chrome:// pages and the Web Store).', recovery: 'none' },
  E_UNSUPPORTED_LANGUAGE: { message: 'This text does not look like English or Nepali, the languages Kokoro Reader speaks.', recovery: 'none' },
  E_EXTRACTION: { message: 'No article text could be found on this page. Try selecting the text you want to hear.', recovery: 'select-text' },
  E_PERMISSION: { message: 'Kokoro Reader needs permission to read this site.', recovery: 'grant-permission' },
  E_TAB_CLOSED: { message: 'The tab being read was closed.', recovery: 'none' },
  E_CANCELLED: { message: 'Reading was cancelled.', recovery: 'none' },
  E_BAD_MESSAGE: { message: 'An internal message was rejected.', recovery: 'retry' },
  E_BROWSER_SPEECH: { message: 'Browser speech is not available on this system.', recovery: 'open-settings' },
  E_EXPORT: { message: 'The audio file could not be created.', recovery: 'retry' },
  E_UNKNOWN: { message: 'Something went wrong.', recovery: 'retry' },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly recovery: RecoveryAction;
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string, message?: string) {
    const spec = ERROR_CATALOG[code];
    super(message ?? spec.message);
    this.name = 'AppError';
    this.code = code;
    this.recovery = spec.recovery;
    this.detail = detail;
  }

  toInfo(): AppErrorInfo {
    return { code: this.code, message: this.message, recovery: this.recovery, detail: this.detail };
  }
}

/** Converts anything thrown into a serialisable AppErrorInfo, classifying common browser failures. */
export function toErrorInfo(error: unknown, fallback: ErrorCode = 'E_UNKNOWN'): AppErrorInfo {
  if (error instanceof AppError) return error.toInfo();
  if (isErrorInfo(error)) return error;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const lower = detail.toLowerCase();
  let code = fallback;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') code = 'E_STORAGE_QUOTA';
  else if (error instanceof DOMException && error.name === 'AbortError') code = 'E_CANCELLED';
  else if (lower.includes('out of memory') || lower.includes('rangeerror: array buffer allocation failed')) code = 'E_OUT_OF_MEMORY';
  else if (lower.includes('quota')) code = 'E_STORAGE_QUOTA';
  const spec = ERROR_CATALOG[code];
  return { code, message: spec.message, recovery: spec.recovery, detail };
}

export function isErrorInfo(value: unknown): value is AppErrorInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppErrorInfo).code === 'string' &&
    (value as AppErrorInfo).code in ERROR_CATALOG &&
    typeof (value as AppErrorInfo).message === 'string'
  );
}
