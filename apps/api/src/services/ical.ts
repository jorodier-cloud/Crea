import { parseIcalBusyDates, walk, type CalendarContent, type PageTree } from '@crea/schema';

/** Le flux le plus lourd vu chez Airbnb/Booking tient largement en dessous. */
const MAX_ICS_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 4000;
/** Cote Cloudflare : evite de solliciter Airbnb/Booking a chaque visite du site. */
const EDGE_CACHE_SECONDS = 1800;

interface CalendarSyncTarget {
  nodeId: string;
  urls: string[];
}

function collectSyncTargets(tree: PageTree): CalendarSyncTarget[] {
  const targets: CalendarSyncTarget[] = [];
  walk(tree.root, ({ node }) => {
    if (node.type !== 'calendar') return;
    const urls = ((node.content as CalendarContent).icalUrls ?? []).filter(Boolean);
    if (urls.length > 0) targets.push({ nodeId: node.id, urls });
  });
  return targets;
}

async function fetchIcsText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cf: { cacheTtl: EDGE_CACHE_SECONDS, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return text.length > MAX_ICS_BYTES ? text.slice(0, MAX_ICS_BYTES) : text;
}

/**
 * Synchronise les blocs calendrier d un arbre publie avec leurs flux iCal.
 *
 * Jamais bloquant pour l affichage du site : un flux injoignable, trop lent
 * ou illisible est ignore silencieusement (juste journalise) — un visiteur ne
 * doit jamais voir une page en erreur parce qu Airbnb repond mal. Le cache
 * Cloudflare cote flux (30 min) evite de re-solliciter les plateformes a
 * chaque visite ; le rendu reste par ailleurs dynamique a chaque requete.
 */
export async function fetchCalendarBlockedDates(tree: PageTree): Promise<Map<string, string[]>> {
  const targets = collectSyncTargets(tree);
  const result = new Map<string, string[]>();
  if (targets.length === 0) return result;

  await Promise.all(
    targets.map(async ({ nodeId, urls }) => {
      const dates = new Set<string>();
      await Promise.all(
        urls.map(async (url) => {
          try {
            const text = await fetchIcsText(url);
            for (const date of parseIcalBusyDates(text)) dates.add(date);
          } catch (error) {
            console.error(
              JSON.stringify({
                event: 'ical_sync_failed',
                nodeId,
                url,
                reason: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }),
      );
      result.set(nodeId, Array.from(dates));
    }),
  );

  return result;
}
