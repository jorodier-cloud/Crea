import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCalendarSync, createStarterTree, parseIcalBusyDates } from '../dist/index.js';

const SAMPLE = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1@airbnb.com
DTSTART;VALUE=DATE:20260910
DTEND;VALUE=DATE:20260913
SUMMARY:Reserved
END:VEVENT
END:VCALENDAR`;

test('parseIcalBusyDates extrait les nuits reservees, DTEND exclu', () => {
  const dates = parseIcalBusyDates(SAMPLE);
  assert.deepEqual(dates, ['2026-09-10', '2026-09-11', '2026-09-12']);
});

test('parseIcalBusyDates ignore les evenements annules', () => {
  const ics = SAMPLE.replace('SUMMARY:Reserved', 'SUMMARY:Reserved\nSTATUS:CANCELLED');
  assert.deepEqual(parseIcalBusyDates(ics), []);
});

test('parseIcalBusyDates fusionne plusieurs evenements et deduplique', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260910
DTEND;VALUE=DATE:20260912
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260911
DTEND;VALUE=DATE:20260914
END:VEVENT
END:VCALENDAR`;
  assert.deepEqual(parseIcalBusyDates(ics), [
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
  ]);
});

test('parseIcalBusyDates deplie les lignes repliees (RFC 5545)', () => {
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:2026\r\n 0910\r\nDTEND;VALUE=DATE:20260911\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  assert.deepEqual(parseIcalBusyDates(ics), ['2026-09-10']);
});

test('parseIcalBusyDates renvoie un tableau vide sur un flux illisible', () => {
  assert.deepEqual(parseIcalBusyDates('ceci n est pas de l iCal'), []);
  assert.deepEqual(parseIcalBusyDates(''), []);
});

test('parseIcalBusyDates sans DTEND compte une seule nuit', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260910
END:VEVENT
END:VCALENDAR`;
  assert.deepEqual(parseIcalBusyDates(ics), ['2026-09-10']);
});

test('applyCalendarSync renvoie le meme arbre (reference) si rien a fusionner', () => {
  const tree = createStarterTree();
  assert.equal(applyCalendarSync(tree, new Map()), tree);
});

test('applyCalendarSync complete blockedDates sans ecraser la saisie manuelle', () => {
  const tree = createStarterTree();
  const calendar = {
    id: 'cal1',
    type: 'calendar',
    content: { mode: 'availability', icalUrls: [], monthsVisible: 2, minNights: 2, locale: 'fr-FR', blockedDates: ['2026-01-01'] },
    styles: {},
    actions: [],
    children: [],
  };
  tree.root.children.push(calendar);

  const next = applyCalendarSync(tree, new Map([['cal1', ['2026-09-10', '2026-01-01']]]));
  const synced = next.root.children.find((node) => node.id === 'cal1');
  assert.deepEqual(synced.content.blockedDates, ['2026-01-01', '2026-09-10']);
  // L arbre d entree n est jamais mute.
  assert.deepEqual(calendar.content.blockedDates, ['2026-01-01']);
});
