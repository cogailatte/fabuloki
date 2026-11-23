

export interface ModelPrice {
  inPerM: number;
  outPerM: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {

  "claude-fable-5-1": { inPerM: 10, outPerM: 50 },
  "claude-opus-5-5": { inPerM: 4, outPerM: 20 },
  "claude-sonnet-5-5": { inPerM: 2, outPerM: 10 },

  "claude-haiku-5-5": { inPerM: 0.1, outPerM: 0.5 },
  "claude-fable-5": { inPerM: 10, outPerM: 50 },
  "claude-mythos-5": { inPerM: 10, outPerM: 50 },
  "claude-opus-5": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-8": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-7": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-6": { inPerM: 5, outPerM: 25 },

  "claude-sonnet-5": { inPerM: 3, outPerM: 15 },
  "claude-sonnet-4-6": { inPerM: 3, outPerM: 15 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },

  "gemini-3.1-flash-image": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-3.1-flash-lite-image": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-3-pro-image": { inPerM: 0.3, outPerM: 2.5 },
};

export const PROVIDER_FALLBACK_PRICES: Record<string, ModelPrice> = {
  gemini: { inPerM: 0.3, outPerM: 2.5 },
};

export function priceFor(
  model: string | null,
  provider: string | null,
): ModelPrice | null {
  if (model && MODEL_PRICES[model]) return MODEL_PRICES[model];
  if (provider && PROVIDER_FALLBACK_PRICES[provider]) {
    return PROVIDER_FALLBACK_PRICES[provider];
  }
  return null;
}
