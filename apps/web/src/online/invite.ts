/**
 * Invite links: the game's own address with `?room=CODE`. A phone on the same Wi-Fi uses the
 * machine's network address instead of `localhost`, which the local server reports. Pure.
 */
import { normalizeRoomCode } from '@undercut/protocol';

/** The room code in a page address (`?room=`), or null. */
export function codeFromUrl(href: string): string | null {
  try {
    return normalizeRoomCode(new URL(href).searchParams.get('room'));
  } catch {
    return null;
  }
}

/** The invite link for `code` on the page at `href` (other query parameters dropped). */
export function inviteLink(href: string, code: string, origin?: string): string {
  const url = new URL(href);
  const base = origin ? new URL(url.pathname, origin) : url;
  base.search = '';
  base.hash = '';
  base.searchParams.set('room', code);
  return base.href;
}

/** `BCDFGH` as `BCD-FGH`, easier to read out. */
export function displayCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/**
 * The address another device on the network should open, from the local server's list of
 * network origins (matching this page's scheme), or null when the page is already on one of them
 * or none is known.
 */
export function networkOrigin(href: string, lan: readonly string[]): string | null {
  const page = new URL(href);
  if (lan.includes(page.origin)) return null;
  return lan.find((o) => o.startsWith(page.protocol)) ?? lan[0] ?? null;
}
