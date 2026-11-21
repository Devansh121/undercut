/**
 * Fetches the files a session needs, with progress by bytes and a retry for whatever failed.
 *
 * Downloads and decoded images are cached for the page's lifetime (keyed by URL), so a second
 * session, or a retry after a failed file, fetches only what is missing. GPU objects are never
 * cached here: each session makes its own textures from the cached images and disposes them.
 */
export interface AssetIndex {
  files: Record<string, number>;
  textures: Record<
    string,
    { sizeM: number; hi: Record<string, string>; lo: Record<string, string> }
  >;
  skies: Record<string, unknown>;
}

export class AssetError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Could not load ${path}: ${reason}`);
    this.name = 'AssetError';
  }
}

export interface Progress {
  loaded: number;
  total: number;
}

const bytesCache = new Map<string, Promise<ArrayBuffer>>();
const imageCache = new Map<string, Promise<ImageBitmap>>();
const sizeCache = new Map<string, number>();

/** Drop failed entries so a retry fetches them again. */
function forgetOnFailure<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  p: Promise<T>,
): Promise<T> {
  p.catch(() => {
    if (cache.get(key) === p) cache.delete(key);
  });
  return p;
}

export class AssetLoader {
  /** Called whenever more bytes arrive or the expected total grows. */
  onProgress: ((p: Progress) => void) | null = null;
  private readonly expected = new Map<string, number>();
  private readonly received = new Map<string, number>();

  /** `base` is the URL of the assets folder, ending in a slash. */
  constructor(readonly base: string) {}

  url(path: string): string {
    return new URL(path, new URL(this.base, document.baseURI)).href;
  }

  /** Declare files about to be fetched and their sizes (from the index), for the progress bar. */
  expect(path: string, bytes: number | undefined): void {
    const url = this.url(path);
    if (this.expected.has(url)) return;
    this.expected.set(url, bytes ?? sizeCache.get(url) ?? 0);
    this.emit();
  }

  progress(): Progress {
    let loaded = 0;
    let total = 0;
    for (const [url, size] of this.expected) {
      const got = this.received.get(url) ?? 0;
      total += Math.max(size, got);
      loaded += got;
    }
    return { loaded, total };
  }

  private emit(): void {
    this.onProgress?.(this.progress());
  }

  bytes(path: string): Promise<ArrayBuffer> {
    const url = this.url(path);
    if (!this.expected.has(url)) this.expected.set(url, sizeCache.get(url) ?? 0);
    const cached = bytesCache.get(url);
    if (cached) {
      void cached.then(
        (b) => {
          this.received.set(url, b.byteLength);
          this.emit();
        },
        () => undefined,
      );
      return cached;
    }
    const p = forgetOnFailure(bytesCache, url, this.download(url, path));
    bytesCache.set(url, p);
    return p;
  }

  private async download(url: string, path: string): Promise<ArrayBuffer> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new AssetError(path, e instanceof Error ? e.message : 'network error');
    }
    if (!res.ok) throw new AssetError(path, `HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? 0);
    // Content-Length is the encoded size when the server compresses; keep the larger estimate.
    if (length > (this.expected.get(url) ?? 0) && !res.headers.get('content-encoding')) {
      this.expected.set(url, length);
    }
    const body = res.body;
    if (!body) {
      const buf = await res.arrayBuffer();
      this.received.set(url, buf.byteLength);
      sizeCache.set(url, buf.byteLength);
      this.emit();
      return buf;
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.byteLength;
        this.received.set(url, got);
        this.emit();
      }
    } catch (e) {
      this.received.delete(url);
      throw new AssetError(path, e instanceof Error ? e.message : 'download interrupted');
    }
    const out = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    sizeCache.set(url, got);
    this.expected.set(url, got);
    this.emit();
    return out.buffer;
  }

  async json<T>(path: string): Promise<T> {
    const buf = await this.bytes(path);
    try {
      return JSON.parse(new TextDecoder().decode(buf)) as T;
    } catch {
      throw new AssetError(path, 'not valid JSON');
    }
  }

  /** A decoded image without colour-space conversion (normal and data maps stay exact). */
  image(path: string, mime = 'image/webp'): Promise<ImageBitmap> {
    const url = this.url(path);
    const cached = imageCache.get(url);
    if (cached) {
      void this.bytes(path).catch(() => undefined);
      return cached;
    }
    const p = forgetOnFailure(
      imageCache,
      url,
      this.bytes(path).then(async (buf) => {
        try {
          return await createImageBitmap(new Blob([buf], { type: mime }), {
            colorSpaceConversion: 'none',
            premultiplyAlpha: 'none',
          });
        } catch {
          throw new AssetError(path, 'could not decode the image');
        }
      }),
    );
    imageCache.set(url, p);
    return p;
  }
}
