export class HttpError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return Boolean(
    err &&
      typeof err === 'object' &&
      (err as { name?: unknown }).name === 'HttpError' &&
      typeof (err as { status?: unknown }).status === 'number'
  );
}
