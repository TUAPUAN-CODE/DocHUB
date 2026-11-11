/** A code piece of an older build that no longer exists on the server (the app was updated while the page was open) */
export const isStaleBuildError = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i
    .test(String((e as { message?: string })?.message ?? e));

/** Reload once to get the new build (not again within 30 s, so a real network problem cannot loop) */
export function reloadForNewBuild() {
  const key = 'dsp.newBuildReload';
  let last = 0;
  try { last = Number(sessionStorage.getItem(key) || 0); } catch { /* private mode */ }
  if (Date.now() - last < 30_000) return false;
  try { sessionStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
  window.location.reload();
  return true;
}
