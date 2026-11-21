/**
 * The client's address, for per-address limits (room creation, unjoined sockets).
 *
 * Deployed, the Worker is only reachable through the Cloudflare edge, which sets
 * `CF-Connecting-IP` to the address of the TCP connection it accepted and drops any
 * value the client sent, so the header is trustworthy there. Locally, both entry points
 * (the static server behind ./start.sh and the Vite dev server) overwrite it from the
 * socket address in the same way; the rooms service listens on 127.0.0.1 only, so no
 * one else can reach it directly. Anything else in front of the Worker must do the same.
 */
export function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
