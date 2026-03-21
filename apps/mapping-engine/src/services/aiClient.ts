/**
 * AI provider factory for the mapping-engine.
 *
 * Per-request clients are built from application-managed partner/platform LLM config.
 * Supported providers: azure | openai | openai-compatible
 */

import OpenAI, { AzureOpenAI } from 'openai';
import type { PartnerLLMConfig } from '@bx/shared-types';

export type AIClient = OpenAI | AzureOpenAI;
const AZURE_API_VERSION = '2024-08-01-preview';

/** Returns true if the endpoint URL belongs to Azure OpenAI. */
function isAzureEndpoint(endpoint?: string): boolean {
  return !!endpoint?.includes('.openai.azure.com');
}

/** Builds a fresh AI client from a partner's own LLM config. */
export function createAIClient(config: PartnerLLMConfig): AIClient {
  // Explicit azure provider OR openai-compatible pointing at an Azure endpoint —
  // both must use AzureOpenAI so the SDK constructs the correct deployment URL
  // and sends `api-key` instead of `Authorization: Bearer`.
  if (config.provider === 'azure' || isAzureEndpoint(config.endpoint)) {
    return new AzureOpenAI({
      apiKey:     config.apiKey,
      endpoint:   (config.endpoint ?? '').replace(/\/+$/, ''),
      apiVersion: AZURE_API_VERSION,
      // model is passed per-call; SDK uses it as the deployment name
    });
  }
  if (config.provider === 'openai') {
    return new OpenAI({ apiKey: config.apiKey });
  }
  // openai-compatible (Groq, Ollama, LM Studio, Together, etc.)
  // Normalize endpoint: strip trailing slash, add /v1 if not already present.
  const base = (config.endpoint ?? '').replace(/\/+$/, '');
  const baseURL = base.endsWith('/v1') ? base : `${base}/v1`;
  return new OpenAI({
    apiKey:  config.apiKey || 'not-needed',
    baseURL,
  });
}
