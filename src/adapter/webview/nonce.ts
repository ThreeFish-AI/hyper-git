import * as crypto from 'crypto';

/**
 * CSP nonce（单一实现，替代各 webview 内联的 randomBytes 拼接）。
 * randomUUID 产 hex（无 base64 的 +/= 字符），对 CSP 属性值更稳。
 */
export function getNonce(): string {
	return crypto.randomUUID().replace(/-/g, '');
}
