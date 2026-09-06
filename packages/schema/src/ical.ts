import { cloneTree, walk } from './tree.js';
import type { CalendarContent, PageTree } from './types/schema.js';

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ParseIcalOptions {
  /** Borne le nombre d evenements lus, pour ne jamais bloquer sur un flux pathologique. */
  maxEvents?: number;
}

/** Deplie les lignes repliees (RFC 5545) : une ligne indentee prolonge la precedente. */
function unfold(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function parseDateValue(value: string): Date | null {
  const cleaned = value.trim();
  let match = DATE_ONLY.exec(cleaned);
  if (match) {
    const [, y, m, d] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  match = DATE_TIME.exec(cleaned);
  if (match) {
    const [, y, m, d] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  return null;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function toIso(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Extrait les dates occupees (reservations) d un flux iCal.
 *
 * Pensee pour des exports Airbnb / Booking / Lodgify : chaque VEVENT est une
 * reservation, DTEND est le jour de depart — exclu, puisqu un depart le matin
 * n empeche pas une arrivee le jour meme. Les evenements annules
 * (STATUS:CANCELLED) sont ignores. Aucune exception levee sur un flux
 * malforme : au pire, aucune date n en ressort.
 */
export function parseIcalBusyDates(icsText: string, options: ParseIcalOptions = {}): string[] {
  const maxEvents = options.maxEvents ?? 3000;
  const lines = unfold(icsText ?? '').split('\n');

  const dates = new Set<string>();
  let inEvent = false;
  let cancelled = false;
  let dtstart: string | null = null;
  let dtend: string | null = null;
  let eventCount = 0;

  const flush = (): void => {
    if (cancelled || !dtstart) return;
    const start = parseDateValue(dtstart);
    if (!start) return;
    const end = dtend ? parseDateValue(dtend) : null;
    const endDate = end && end.getTime() > start.getTime() ? end : new Date(start.getTime() + DAY_MS);

    let cursor = start;
    let guard = 0;
    while (cursor.getTime() < endDate.getTime() && guard < 730) {
      dates.add(toIso(cursor));
      cursor = new Date(cursor.getTime() + DAY_MS);
      guard += 1;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') {
      if (eventCount >= maxEvents) break;
      inEvent = true;
      cancelled = false;
      dtstart = null;
      dtend = null;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent) {
        flush();
        eventCount += 1;
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const rawKey = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const key = rawKey.split(';')[0]!.toUpperCase();

    if (key === 'DTSTART') dtstart = value;
    else if (key === 'DTEND') dtend = value;
    else if (key === 'STATUS' && value.trim().toUpperCase() === 'CANCELLED') cancelled = true;
  }

  return Array.from(dates).sort();
}

/**
 * Fusionne, pour chaque bloc calendrier concerne, les dates issues d un flux
 * iCal avec celles saisies a la main (`blockedDates` n est jamais remplace,
 * seulement complete). Pure : renvoie l arbre recu tel quel — meme reference —
 * si `syncedByNodeId` est vide, sans jamais muter l entree.
 */
export function applyCalendarSync(
  tree: PageTree,
  syncedByNodeId: ReadonlyMap<string, string[]>,
): PageTree {
  if (syncedByNodeId.size === 0) return tree;

  const next = cloneTree(tree);
  walk(next.root, ({ node }) => {
    if (node.type !== 'calendar') return;
    const synced = syncedByNodeId.get(node.id);
    if (!synced || synced.length === 0) return;
    const content = node.content as CalendarContent;
    content.blockedDates = Array.from(new Set([...(content.blockedDates ?? []), ...synced])).sort();
  });
  return next;
}
