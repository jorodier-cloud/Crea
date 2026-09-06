import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HONEYPOT_FIELD,
  MAX_FIELD_LENGTH,
  findFirstFormNode,
  findFormNode,
  missingRequired,
  readSubmission,
} from '../dist-test/lib/contact.js';

function node(id, fields) {
  return { id, type: 'form', content: { fields }, styles: {}, actions: [], children: [] };
}

const FORM = node('form-contact', [
  { id: 'f1', name: 'nom', label: 'Votre nom', type: 'text', required: true },
  { id: 'f2', name: 'email', label: 'Votre email', type: 'email', required: true },
  { id: 'f3', name: 'message', label: 'Votre message', type: 'textarea', required: false },
]);

const TREE = {
  version: 1,
  meta: {},
  theme: {},
  root: {
    id: 'root',
    type: 'container',
    content: {},
    styles: {},
    actions: [],
    children: [
      { id: 'titre', type: 'text', content: {}, styles: {}, actions: [], children: [] },
      {
        id: 'section',
        type: 'container',
        content: {},
        styles: {},
        actions: [],
        children: [FORM],
      },
    ],
  },
};

test('le formulaire est retrouve par son identifiant, meme imbrique', () => {
  assert.equal(findFormNode(TREE, 'form-contact')?.id, 'form-contact');
  assert.equal(findFormNode(TREE, 'inconnu'), null);
});

test('a defaut d identifiant, le premier formulaire de la page est pris', () => {
  assert.equal(findFirstFormNode(TREE)?.id, 'form-contact');
  // Une page sans formulaire ne doit pas en inventer un.
  assert.equal(findFirstFormNode({ ...TREE, root: { ...TREE.root, children: [] } }), null);
});

test('seuls les champs declares par le formulaire sont retenus', () => {
  // Un robot peut poster ce qu il veut : accepter des champs arbitraires
  // laisserait remplir la base et les emails de contenu choisi.
  const { fields } = readSubmission(FORM, {
    nom: 'Jonathan',
    message: 'Bonjour',
    admin: 'true',
    montant: '0',
  });
  assert.deepEqual(fields, [
    { label: 'Votre nom', value: 'Jonathan' },
    { label: 'Votre message', value: 'Bonjour' },
  ]);
});

test('les champs sont rendus dans l ordre du formulaire, pas de la soumission', () => {
  const { fields } = readSubmission(FORM, { message: 'Bonjour', nom: 'Jonathan' });
  assert.deepEqual(
    fields.map((f) => f.label),
    ['Votre nom', 'Votre message'],
  );
});

test('l expediteur est identifie pour le sujet et la reponse', () => {
  const { senderName, senderEmail } = readSubmission(FORM, {
    nom: 'Jonathan Rodier',
    email: '  CONTACT@Exemple.FR  ',
  });
  assert.equal(senderName, 'Jonathan Rodier');
  assert.equal(senderEmail, 'contact@exemple.fr');
});

test('une adresse invalide n est pas retenue comme expediteur', () => {
  // Elle resterait affichee dans la demande, mais servir de `reply-to` a une
  // valeur non validee ferait echouer l envoi.
  const { senderEmail, fields } = readSubmission(FORM, { nom: 'X', email: 'pas-une-adresse' });
  assert.equal(senderEmail, null);
  assert.ok(fields.some((f) => f.value === 'pas-une-adresse'));
});

test('les valeurs sont coupees et les champs vides ignores', () => {
  const { fields } = readSubmission(FORM, {
    nom: '   ',
    message: 'x'.repeat(MAX_FIELD_LENGTH + 500),
  });
  assert.equal(fields.length, 1);
  assert.equal(fields[0].value.length, MAX_FIELD_LENGTH);
});

test('les champs obligatoires manquants sont nommes', () => {
  assert.deepEqual(missingRequired(FORM, { nom: 'Jonathan' }), ['Votre email']);
  assert.deepEqual(missingRequired(FORM, { nom: ' ', email: '' }), [
    'Votre nom',
    'Votre email',
  ]);
  assert.deepEqual(missingRequired(FORM, { nom: 'J', email: 'a@b.fr' }), []);
});

test('le champ piege porte un nom qui ne peut entrer en collision', () => {
  // Il ne doit jamais correspondre a un champ que quelqu un declarerait.
  assert.match(HONEYPOT_FIELD, /^_crea_/);
});
