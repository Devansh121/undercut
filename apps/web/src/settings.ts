const ROOMS_URL_KEY = 'settings.roomsUrl';

/**
 * Resolve the rooms service base URL. An empty or missing override means same-origin
 * `/rooms`, which is what the local server and any later static host provide.
 */
export function resolveRoomsUrl(pageUrl: string, override: string | null | undefined): string {
  const url = new URL(override && override.trim() !== '' ? override.trim() : '/rooms', pageUrl);
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '');
}

/** WebSocket URL for one room under a rooms base URL. */
export function roomSocketUrl(roomsUrl: string, roomId: string): string {
  const url = new URL(`${roomsUrl.replace(/\/+$/, '')}/${encodeURIComponent(roomId)}`);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  return url.href;
}

/** The rooms URL for this page: a saved setting, else the build-time value, else same-origin. */
export function roomsUrl(): string {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(ROOMS_URL_KEY);
  } catch {
    // Storage blocked (private mode, embedded); fall through to the default.
  }
  return resolveRoomsUrl(window.location.href, saved ?? import.meta.env.VITE_ROOMS_URL);
}
