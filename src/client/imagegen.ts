/** Token image generation via fal.ai Nano Banana 2 Pro (Gemini-based). */

const FAL_SYNC_BASE = "https://fal.run";
const FAL_MODEL = "fal-ai/nano-banana-pro";

interface FalImage {
  url: string;
  content_type: string;
  width: number;
  height: number;
}

interface FalResponse {
  images: FalImage[];
}

/**
 * Generate a token image using fal.ai Nano Banana 2 Pro.
 * Requires FAL_API_KEY environment variable.
 * @param prompt - Image generation prompt describing the token logo.
 * @returns Public URL of the generated image.
 */
export async function generateTokenImage(prompt: string): Promise<string> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    throw new Error("FAL_API_KEY environment variable not set. Cannot generate images.");
  }

  const res = await fetch(`${FAL_SYNC_BASE}/${FAL_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      num_images: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`fal.ai Nano Banana failed: HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as FalResponse;
  if (!data.images?.[0]?.url) {
    throw new Error("fal.ai Nano Banana returned no images");
  }

  return data.images[0].url;
}

const STYLE_LINEAGES = [
  "Swiss modernist corporate symbol, Saul Bass reduction",
  "Japanese mon design, single-weight brushstroke geometry",
  "Pentagram studio emblem, heavy geometric letterform",
  "Noto system visual weight, clean sans-serif glyph treatment",
] as const;

const PALETTE_PAIRS = [
  { accent: "gold (#d4a017)", field: "near-black (#0d0d10)" },
  { accent: "acid green (#b5ff2b)", field: "deep charcoal (#111114)" },
  { accent: "electric blue (#2b7fff)", field: "ink black (#0a0a0f)" },
  { accent: "warm white (#f0ece2)", field: "dark slate (#12141a)" },
] as const;

/**
 * Pick a deterministic-but-varied index from a seed string.
 * @param seed - Any string to derive an index from.
 * @param length - Array length to mod against.
 * @returns An index in [0, length).
 */
function seedIndex(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
}

/**
 * Decide whether the token concept is abstract or iconographic.
 * Abstract names get typographic treatment; concrete names get a symbolic glyph.
 * @param name - Token name.
 * @param description - Token description.
 * @returns Visual direction string for the prompt.
 */
function resolveSubject(name: string, description: string): string {
  const concrete =
    /animal|fire|water|moon|sun|star|rock|tree|wave|bolt|eye|skull|crown|sword|shield|dragon|cat|dog|frog|bird/i;
  const hasConcreteNoun = concrete.test(name) || concrete.test(description);

  if (hasConcreteNoun) {
    const noun = (name.match(concrete) || description.match(concrete))![0].toLowerCase();
    return `Single geometric ${noun} glyph, reduced to essential contour, centered, occupying roughly a third of the frame`;
  }

  const initial = name.trim().charAt(0).toUpperCase();
  return (
    `Bold typographic treatment of the letterform "${initial}", ` +
    `heavy weight, clean geometric construction, centered, occupying roughly a third of the frame`
  );
}

/**
 * Build a creative-director-grade prompt for Nano Banana 2 Pro.
 * Describes the actual image in present tense — materials, light, lineage.
 * @param name - Token name.
 * @param symbol - Token symbol.
 * @param description - Token description.
 * @returns A prompt string for image generation.
 */
export function buildImagePrompt(name: string, symbol: string, description: string): string {
  const seed = `${name}:${symbol}`;
  const style = STYLE_LINEAGES[seedIndex(seed, STYLE_LINEAGES.length)];
  const palette = PALETTE_PAIRS[seedIndex(seed + ":color", PALETTE_PAIRS.length)];
  const subject = resolveSubject(name, description);

  return [
    `Circular emblem on a ${palette.field} matte background, approximately 10% brightness, warm undertone.`,
    `${subject}.`,
    `Accent color: ${palette.accent} on dark field.`,
    `The form reads clearly at thumbnail scale — ink-weight consistency across all edges.`,
    `Visual language: ${style}.`,
    `Matte finish, no specular highlights, no gradients, no drop shadows, ink-on-paper feel.`,
    `Rendered with graphic precision, print-ready fidelity, suitable for single-color reproduction at 32px.`,
  ].join(" ");
}
