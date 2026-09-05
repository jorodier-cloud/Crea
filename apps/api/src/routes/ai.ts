import { Hono } from 'hono';
import { applyOperations, normalizeTree, SchemaError, type PageTree } from '@crea/schema';

import type { AppBindings } from '../env.js';
import { badRequest, paymentRequired, readJson, requireString } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { generateOperations } from '../services/anthropic.js';
import { computePoints, POINTS_PRICING } from '../services/points.js';
import { getProject, updateProject } from '../services/projects.js';
import { deductPoints, findUserById } from '../services/users.js';

export const aiRoutes = new Hono<AppBindings>();

aiRoutes.use('*', requireAuth);

/** Bareme public, affiche dans l interface. */
aiRoutes.get('/pricing', (c) => c.json({ pricing: POINTS_PRICING }));

/**
 * Cycle complet : etat JSON + demande -> operations -> nouvel AST.
 *
 * Le modele ne renvoie que des operations ; c est le serveur qui les applique,
 * les valide, sauvegarde et debite les points. Une reponse IA aberrante ne peut
 * donc pas corrompre le projet.
 */
aiRoutes.post('/prompt', async (c) => {
  const body = await readJson<{
    projectId?: unknown;
    prompt?: unknown;
    tree?: unknown;
    selectedNodeId?: unknown;
    save?: unknown;
  }>(c.req.raw);

  const projectId = requireString(body.projectId, 'projectId', { max: 64 });
  const prompt = requireString(body.prompt, 'prompt', { max: 4000 });
  const selectedNodeId =
    typeof body.selectedNodeId === 'string' && body.selectedNodeId.length > 0
      ? body.selectedNodeId
      : null;
  const save = body.save !== false;

  const user = c.get('user');
  const project = await getProject(c.env, user.id, projectId);

  // L etat de travail du navigateur prime sur l etat sauvegarde, apres validation.
  let tree: PageTree = project.tree;
  if (body.tree !== undefined) {
    try {
      tree = normalizeTree(body.tree).tree;
    } catch (error) {
      if (error instanceof SchemaError) throw badRequest(`Arbre invalide : ${error.message}`, error.issues);
      throw error;
    }
  }

  const account = await findUserById(c.env, user.id);
  if (!account) throw badRequest('Compte introuvable.');
  if (account.ia_points_balance <= 0) {
    throw paymentRequired('Solde de points IA epuise.', { balance: account.ia_points_balance });
  }

  const generation = await generateOperations(c.env, {
    tree,
    prompt,
    selectedNodeId,
  });

  const cost = computePoints(generation.usage);
  const deduction = await deductPoints(c.env, user.id, cost);
  // Si le cout depasse le reliquat, on solde le compte a zero plutot que de
  // jeter un travail deja paye au fournisseur.
  const balance = deduction.ok
    ? deduction.balance
    : (await deductPoints(c.env, user.id, account.ia_points_balance)).balance;

  const result = applyOperations(tree, generation.payload.operations);

  // Re-normalisation defensive : l arbre ecrit en base est toujours conforme.
  const normalized = normalizeTree(JSON.parse(JSON.stringify(result.tree)));

  if (save && result.applied.length > 0) {
    await updateProject(c.env, user.id, projectId, { tree: normalized.tree });
  }

  return c.json({
    message: generation.payload.message,
    tree: normalized.tree,
    operations: generation.payload.operations,
    applied: result.applied.length,
    errors: [...result.errors, ...generation.rejected, ...normalized.issues],
    saved: save && result.applied.length > 0,
    usage: {
      model: generation.model,
      inputTokens: generation.usage.inputTokens,
      outputTokens: generation.usage.outputTokens,
      cacheReadInputTokens: generation.usage.cacheReadInputTokens,
      cacheCreationInputTokens: generation.usage.cacheCreationInputTokens,
    },
    points: {
      spent: deduction.ok ? cost : account.ia_points_balance,
      balance,
      overdrawn: !deduction.ok,
    },
  });
});
