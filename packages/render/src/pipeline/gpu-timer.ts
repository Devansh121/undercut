/**
 * GPU time per frame through EXT_disjoint_timer_query_webgl2 where the browser exposes it, so
 * dynamic resolution reacts to GPU load and not to the vsync-capped frame interval. Results
 * arrive a few frames late; `latest` is the most recent one (ms), or null when unavailable.
 */
interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export class GpuTimer {
  latest: number | null = null;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerExt | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get available(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    this.poll();
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    const ext = this.ext;
    if (!ext) return;
    while (this.pending.length > 0) {
      const q = this.pending[0] as WebGLQuery;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.latest = ns / 1e6;
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }

  /** The context was lost: its queries are gone; forget them without touching GL. */
  abandon(): void {
    this.pending.length = 0;
    this.active = null;
    this.latest = null;
  }

  dispose(): void {
    if (this.active && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const q of this.pending) this.gl.deleteQuery(q);
    if (this.active) this.gl.deleteQuery(this.active);
    this.pending.length = 0;
    this.active = null;
  }
}
