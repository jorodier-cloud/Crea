/**
 * Conversion tokens -> Points IA.
 *
 * Bareme volontairement lisible pour l utilisateur final : un point ~ 1000
 * tokens d entree. La sortie est facturee cinq fois plus cher, a l image du
 * cout reel du modele ; les tokens relus depuis le cache sont quasi gratuits.
 */
export const POINTS_PRICING = {
  inputPer1kTokens: 1,
  cacheWritePer1kTokens: 1.25,
  cacheReadPer1kTokens: 0.1,
  outputPer1kTokens: 5,
  minimumPerRequest: 1,
} as const;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** Cout en points, arrondi au superieur, plancher a 1 point par requete. */
export function computePoints(usage: TokenUsage): number {
  const cost =
    (usage.inputTokens / 1000) * POINTS_PRICING.inputPer1kTokens +
    (usage.cacheCreationInputTokens / 1000) * POINTS_PRICING.cacheWritePer1kTokens +
    (usage.cacheReadInputTokens / 1000) * POINTS_PRICING.cacheReadPer1kTokens +
    (usage.outputTokens / 1000) * POINTS_PRICING.outputPer1kTokens;

  return Math.max(POINTS_PRICING.minimumPerRequest, Math.ceil(cost));
}

/** Estimation avant appel, pour prevenir l utilisateur d un solde trop bas. */
export function estimatePoints(promptChars: number, treeChars: number): number {
  const approximateInputTokens = (promptChars + treeChars) / 3.5;
  return computePoints({
    ...EMPTY_USAGE,
    inputTokens: approximateInputTokens,
    outputTokens: 1200,
  });
}
