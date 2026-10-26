import type { ApiErrorBody, ErrorCode } from '@aangan/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../logger.js';

// Thrown by routes and services for an expected failure. Its message is written for the
// client, so it is safe to send as is.
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody('not_found', 'Not found.'));
};

// express.json() reports a bad body with a `type` field rather than an error class.
function bodyParserErrorType(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) return undefined;
  return typeof error.type === 'string' ? error.type : undefined;
}

// Express, its router and body-parser mark a client's mistake (an unsupported charset or
// encoding, an undecodable URL parameter) with a 4xx `status`. Those are not server errors:
// answer with that status, and keep them out of the error log.
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      // Too late to send our envelope; Express ends the response. Log it as ours first.
      logger.error({ err: error, reqId: req.id }, 'error after the response started');
      next(error);
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json(errorBody(error.code, error.message, error.details));
      return;
    }
    const type = bodyParserErrorType(error);
    if (type === 'entity.parse.failed') {
      res.status(400).json(errorBody('malformed_json', 'The request body is not valid JSON.'));
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json(errorBody('payload_too_large', 'The request body is too large.'));
      return;
    }
    const clientStatus = clientErrorStatus(error);
    if (clientStatus !== undefined) {
      res
        .status(clientStatus)
        .json(errorBody('bad_request', 'The request could not be processed.'));
      return;
    }
    // Anything else is a bug or an outage. The detail goes to the log, never to the client:
    // messages and stack traces are reconnaissance (docs/04 §7).
    logger.error({ err: error, reqId: req.id }, 'unhandled error');
    res.status(500).json(errorBody('internal_error', 'Something went wrong. Please try again.'));
  };
}
