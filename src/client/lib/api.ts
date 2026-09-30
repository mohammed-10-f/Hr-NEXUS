export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, credentials: 'include' });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    const error = new Error(typeof data?.message === 'string' ? data.message : (typeof data?.error === 'string' ? data.error : 'تعذر تنفيذ الطلب.'));
    (error as Error & { code?: string; referenceId?: string }).code = typeof data?.error === 'string' ? data.error : undefined;
    (error as Error & { code?: string; referenceId?: string; details?: unknown }).referenceId = typeof data?.referenceId === 'string' ? data.referenceId : undefined;
    (error as Error & { code?: string; referenceId?: string; details?: unknown }).details = Array.isArray(data?.details) ? data.details : undefined;
    throw error;
  }
  return data as T;
}
