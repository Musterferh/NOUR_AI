export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiJson<T>(url: string, init?: RequestInit, onResponse?: (response: Response) => void): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'same-origin' });
  let validJson = true;
  const body: unknown = await response.json().catch(() => { validJson = false; return null; });
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
    throw new ApiError(typeof detail === 'string' ? detail : `Request failed (${response.status}). Please try again.`, response.status);
  }
  if (!validJson && response.status !== 204) throw new ApiError('The server returned an unexpected response.', response.status);
  onResponse?.(response);
  return body as T;
}

export const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
