/**
 * HUD notices, one on screen at a time for a span of real time. `say` replaces whatever is up;
 * `queue` waits its turn behind the current notice and anything queued before it.
 */
export class NoticeQueue<T> {
  current: T | null = null;
  private left = 0;
  private readonly waiting: { notice: T; seconds: number }[] = [];

  say(notice: T, seconds: number): void {
    this.current = notice;
    this.left = seconds;
  }

  queue(notice: T, seconds: number): void {
    if (this.current === null) this.say(notice, seconds);
    else this.waiting.push({ notice, seconds });
  }

  tick(dt: number): void {
    if (this.current !== null) {
      this.left -= dt;
      if (this.left <= 0) this.current = null;
    }
    if (this.current === null) {
      const next = this.waiting.shift();
      if (next) this.say(next.notice, next.seconds);
    }
  }

  clear(): void {
    this.current = null;
    this.waiting.length = 0;
  }
}
