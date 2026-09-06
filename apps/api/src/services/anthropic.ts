import Anthropic from '@anthropic-ai/sdk';
import {
  AI_SYSTEM_PROMPT,
  buildUserMessage,
  parseAiResponse,
  type AiResponsePayload,
  type PageTree,
} from '@crea/schema';

import type { Env } from '../env.js';
import { badRequest, notConfigured, serverError, tooManyRequests } from '../lib/http.js';
import { EMPTY_USAGE, type TokenUsage } from './points.js';

// Sonnet 5 : 60% moins cher qu Opus 5, largement capable pour une sortie JSON
// stricte accompagnee de texte court. Un modele qui se trompe plus souvent sur
// le format ne fait pas economiser : les operations rejetees font payer les
// memes tokens pour moins de resultat utile.
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 16_000;

export interface GenerationInput {
  tree: PageTree;
  prompt: string;
  selectedNodeId?: string | null;
}

export interface GenerationOutput {
  payload: AiResponsePayload;
  usage: TokenUsage;
  model: string;
  rejected: string[];
}

function readUsage(usage: Anthropic.Usage | undefined): TokenUsage {
  if (!usage) return EMPTY_USAGE;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Appelle Claude et retourne des operations sur l AST.
 *
 * Le prompt systeme est stable et marque `cache_control` : d une requete a
 * l autre, seule la partie volatile (arbre + demande) est refacturee plein tarif.
 */
export async function generateOperations(
  env: Env,
  input: GenerationInput,
): Promise<GenerationOutput> {
  if (!env.ANTHROPIC_API_KEY) {
    throw notConfigured(
      'ANTHROPIC_API_KEY absent. Renseigner le secret pour activer le moteur IA.',
    );
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: AI_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserMessage(input) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw notConfigured('Cle API Anthropic refusee.');
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw tooManyRequests('Moteur IA sature, reessayer dans quelques secondes.');
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw badRequest(`Requete refusee par le modele : ${error.message}`);
    }
    if (error instanceof Anthropic.APIError) {
      throw serverError(`Erreur du moteur IA (${error.status ?? 'inconnue'}).`);
    }
    throw error;
  }

  const usage = readUsage(response.usage);

  if (response.stop_reason === 'refusal') {
    throw badRequest(
      'Le modele a refuse cette demande. Reformuler en restant sur la construction du site.',
    );
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw serverError('Reponse vide du moteur IA.');
  }

  try {
    const { payload, rejected } = parseAiResponse(text);
    return { payload, usage, model: response.model ?? model, rejected };
  } catch (error) {
    throw serverError(
      `Reponse IA non exploitable : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
