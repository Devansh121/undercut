/** Leave the old build active until every tab has closed, so chunks never mix versions. */
export function registerOffline(): void {
  const query = new URLSearchParams(location.search);
  if (query.has('debug') && query.get('offline') !== '1') return;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {
      // Insecure Wi-Fi origins and blocked storage still support online play.
    });
  });
}
