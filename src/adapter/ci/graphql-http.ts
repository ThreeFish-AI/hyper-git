/**
 * GitHub GraphQL 共享 HTTP 传输（CI / Branches PR 两个服务共用）。
 *
 * 超时/销毁可中止的 fetch 机制归此处单一实现，消除两服务各自维护同一份超时语义的漂移面；
 * 冷却/限流/降级策略仍归各服务（机制与策略分离）。每请求独立 AbortController，超时与
 * 调用方 dispose 信号任一触发即中止，finally 清理监听与定时器。
 */

/** fetch + 单请求超时 + dispose 可中止（绝不泄漏监听器与定时器）。 */
export async function fetchWithTimeout(
	fetchImpl: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	disposeSignal: AbortSignal,
): Promise<Response> {
	const reqAc = new AbortController();
	const onDispose = (): void => reqAc.abort();
	disposeSignal.addEventListener('abort', onDispose, { once: true });
	const timer = setTimeout(() => reqAc.abort(), timeoutMs);
	try {
		return await fetchImpl(url, { ...init, signal: reqAc.signal });
	} finally {
		clearTimeout(timer);
		disposeSignal.removeEventListener('abort', onDispose);
	}
}
