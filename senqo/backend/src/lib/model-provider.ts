export type ModelProvider = "openrouter" | "openai" | "groq";

export const MODEL_PROVIDERS: readonly ModelProvider[] = [
  "openrouter",
  "openai",
  "groq",
];

export function parseModelProvider(raw: string): ModelProvider {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "openrouter" || normalized === "openai" || normalized === "groq") {
    return normalized;
  }
  throw new Error(
    `MODEL_PROVIDER must be one of: ${MODEL_PROVIDERS.join(", ")} (got "${raw}")`,
  );
}
