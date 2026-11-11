// Rate-limited, cached HTTP client for the asset scripts.
// - Descriptive User-Agent on every request.
// - At most one request per host every `minIntervalMs` (default 1100 ms).
// - Honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY through undici's EnvHttpProxyAgent.
// - Downloads are cached on disk; a cached file is never fetched again unless --refresh.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export const USER_AGENT =
  'ModuloRagdollAssetFetcher/0.1 (open-source hobby game; +https://github.com/leiffurthersocial-rgb/modulo-ragdoll)';

if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const lastRequestAt = new Map<string, number>();
let minIntervalMs = 1100;

export function setMinInterval(ms: number): void {
  minIntervalMs = ms;
}

async function throttle(url: string): Promise<void> {
  const host = new URL(url).host;
  const now = Date.now();
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minIntervalMs - now;
  lastRequestAt.set(host, Math.max(now, last + minIntervalMs));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  retries?: number;
}

export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  let attempt = 0;
  for (;;) {
    await throttle(url);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...opts.headers },
        redirect: 'follow',
      });
      // Retry only on transient statuses. 403/404 etc. are final.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (err) {
      if (err instanceof HttpError || attempt >= retries) throw err;
      attempt++;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

export async function getText(url: string, opts?: RequestOptions): Promise<string> {
  return (await request(url, opts)).text();
}

export async function getJson<T>(url: string, opts?: RequestOptions): Promise<T> {
  return (await request(url, { ...opts, headers: { Accept: 'application/json', ...opts?.headers } })).json() as Promise<T>;
}

export interface DownloadResult {
  path: string;
  bytes: number;
  cached: boolean;
}

/** Download `url` to `dest` unless it already exists (and `refresh` is false). Atomic via .part file. */
export async function download(
  url: string,
  dest: string,
  opts: RequestOptions & { refresh?: boolean; maxBytes?: number } = {},
): Promise<DownloadResult> {
  if (!opts.refresh && existsSync(dest)) {
    return { path: dest, bytes: statSync(dest).size, cached: true };
  }
  mkdirSync(dirname(dest), { recursive: true });
  const res = await request(url, opts);
  const len = Number(res.headers.get('content-length') ?? 0);
  const maxBytes = opts.maxBytes ?? 200 * 1024 * 1024;
  if (len > maxBytes) throw new Error(`Refusing ${url}: ${len} bytes exceeds limit ${maxBytes}`);
  if (!res.body) throw new Error(`Empty body for ${url}`);
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(part));
  } catch (err) {
    if (existsSync(part)) unlinkSync(part);
    throw err;
  }
  renameSync(part, dest);
  return { path: dest, bytes: statSync(dest).size, cached: false };
}
