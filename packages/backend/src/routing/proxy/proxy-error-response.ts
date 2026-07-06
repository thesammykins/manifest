import { escapeHtml } from '../../common/utils/html-escape';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeExceptionResponse(response: unknown): unknown {
  if (typeof response === 'string') {
    return { error: { message: escapeHtml(response), type: 'proxy_error' } };
  }
  if (!isJsonObject(response)) return response;

  const sanitized: JsonObject = { ...response };
  if (typeof sanitized['message'] === 'string') {
    sanitized['message'] = escapeHtml(sanitized['message']);
  }

  const error = sanitized['error'];
  if (isJsonObject(error)) {
    const sanitizedError: JsonObject = { ...error };
    if (typeof sanitizedError['message'] === 'string') {
      sanitizedError['message'] = escapeHtml(sanitizedError['message']);
    }
    sanitized['error'] = sanitizedError;
  }

  return sanitized;
}
