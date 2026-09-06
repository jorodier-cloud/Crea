import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAIL_FROM,
  buildMagicLinkEmail,
  isMailerConfigured,
  mailFrom,
  minutesUntil,
  readMailError,
} from '../dist-test/lib/mailer.js';

const NOW = new Date('2026-09-06T10:00:00Z');
const IN_15_MIN = Math.floor(NOW.getTime() / 1000) + 15 * 60;

test('sans cle API, aucun envoi n est possible', () => {
  assert.equal(isMailerConfigured({}), false);
  assert.equal(isMailerConfigured({ RESEND_API_KEY: '' }), false);
  assert.equal(isMailerConfigured({ RESEND_API_KEY: '   ' }), false);
  assert.equal(isMailerConfigured({ RESEND_API_KEY: 're_abc' }), true);
});

test('l expediteur retombe sur le domaine de test de Resend', () => {
  assert.equal(mailFrom({}), DEFAULT_MAIL_FROM);
  assert.equal(mailFrom({ MAIL_FROM: '  ' }), DEFAULT_MAIL_FROM);
  assert.equal(
    mailFrom({ MAIL_FROM: 'Crea <bonjour@exemple.fr>' }),
    'Crea <bonjour@exemple.fr>',
  );
});

test('la validite restante est arrondie a la minute et jamais negative', () => {
  assert.equal(minutesUntil(IN_15_MIN, NOW), 15);
  assert.equal(minutesUntil(Math.floor(NOW.getTime() / 1000) + 90, NOW), 2);
  // Lien deja expire : afficher "-3 minutes" serait absurde.
  assert.equal(minutesUntil(Math.floor(NOW.getTime() / 1000) - 200, NOW), 0);
});

test('le lien apparait dans les deux versions du message', () => {
  const link = 'https://crea-web.jino.workers.dev/auth/verify?token=abc123';
  const mail = buildMagicLinkEmail({ link, expiresAt: IN_15_MIN, now: NOW });

  assert.match(mail.subject, /lien de connexion/i);
  assert.ok(mail.text.includes(link), 'le lien manque dans la version texte');
  assert.ok(mail.html.includes(`href="${link}"`), 'le lien manque dans le bouton HTML');
  // Repete en clair : certains clients mail neutralisent les boutons.
  assert.equal(mail.html.split(link).length - 1, 2);
  assert.match(mail.text, /15 minutes/);
  assert.match(mail.html, /15 minutes/);
});

test('les caracteres speciaux du jeton sont echappes dans le HTML', () => {
  // Un `&` non echappe tronque l URL dans certains clients : le lien devient
  // invalide sans que rien ne le signale.
  const link = 'https://crea.test/auth/verify?token=a%2Bb&x=<script>';
  const mail = buildMagicLinkEmail({ link, expiresAt: IN_15_MIN, now: NOW });

  assert.ok(!mail.html.includes('<script>'), 'balise injectee dans le HTML');
  assert.ok(mail.html.includes('&amp;x='), 'l esperluette aurait du etre echappee');
  // La version texte, elle, ne doit pas etre alteree.
  assert.ok(mail.text.includes(link));
});

test('aucun secret ne fuit dans le sujet', () => {
  const mail = buildMagicLinkEmail({
    link: 'https://crea.test/auth/verify?token=jeton-secret',
    expiresAt: IN_15_MIN,
    now: NOW,
  });
  assert.ok(!mail.subject.includes('jeton-secret'));
});

test('l erreur Resend est lisible quelle que soit la forme du corps', () => {
  assert.equal(
    readMailError(422, '{"message":"The from address is not verified","name":"validation_error"}'),
    'The from address is not verified',
  );
  assert.equal(readMailError(500, 'Internal Server Error'), 'Internal Server Error');
  assert.equal(readMailError(502, '   '), 'Resend a repondu 502 sans detail.');
  // Un corps enorme ne doit pas remplir les journaux.
  assert.ok(readMailError(500, 'x'.repeat(5000)).length <= 200);
});
