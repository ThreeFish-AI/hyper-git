/**
 * GitHub GraphQL 共享 HTTP 传输（CI / Branches PR 两个服务共用）。
 *
 * 超时/销毁可中止的 fetch 机制归此处单一实现，消除两服务各自维护同一份超时语义的漂移面；
 * 冷却/限流/降级策略仍归各服务（机制与策略分离）。每请求独立 AbortController，超时与
 * 调用方 dispose 信号任一触发即中止；**保护伞覆盖到 body 读取完成**（done() 前）——
 * 仅到响应头即清定时器会使慢滴 body 的 res.json() 无界挂起，钉死唯一 inflight 槽。
 */

/** fetch + 单请求超时 + dispose 可中止；返回响应与 done()（body 消费完成后调用，解除定时器与监听）。 */
export async function fetchWithTimeout(
	fetchImpl: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	disposeSignal: AbortSignal,
): Promise<{ res: Response; done: () => void }> {
	if (disposeSignal.aborted) {
		// 已中止的信号不会再向事后注册的监听器分发事件——入口短路，兑现「任一触发即中止」承诺。
		throw Object.assign(new Error('dispose signal already aborted'), { name: 'AbortError' });
	}
	const reqAc = new AbortController();
	const onDispose = (): void => reqAc.abort();
	disposeSignal.addEventListener('abort', onDispose, { once: true });
	const timer = setTimeout(() => reqAc.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetchImpl(url, { ...init, signal: reqAc.signal });
	} catch (e) {
		clearTimeout(timer);
		disposeSignal.removeEventListener('abort', onDispose);
		throw e;
	}
	const done = (): void => {
		clearTimeout(timer);
		disposeSignal.removeEventListener('abort', onDispose);
	};
	return { res, done };
}
