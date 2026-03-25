/** pump_generate_token_image — Generate a token logo image from a text prompt. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";

const inputSchema = {
  prompt: z
    .string()
    .describe(
      "Description of the token image to generate (e.g. 'A cute cartoon cat wearing sunglasses with a golden coin')",
    ),
  provider: z
    .enum(["fal", "replicate"])
    .optional()
    .describe(
      "Image gen provider: 'fal' (Nano Banana 2 Pro) or 'replicate'. Default: from IMAGE_GEN_PROVIDER env or fal.",
    ),
};

/**
 * Register the pump_generate_token_image tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerGenerateTokenImage(server: McpServer) {
  server.tool(
    "pump_generate_token_image",
    "Generate a token logo image from a text prompt using AI image generation (fal.ai or Replicate). Returns a URL to the generated image.",
    inputSchema,
    async ({ prompt, provider }) => {
      try {
        const selectedProvider = provider ?? process.env.IMAGE_GEN_PROVIDER ?? "fal";

        if (selectedProvider === "fal") {
          return await generateWithFal(prompt);
        } else if (selectedProvider === "replicate") {
          return await generateWithReplicate(prompt);
        }

        throw new Error(`Unknown provider: ${selectedProvider}. Use 'fal' or 'replicate'.`);
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}

/**
 * Generate image using fal.ai (Nano Banana 2 Pro).
 * @param prompt - Image description.
 * @returns MCP tool result with image URL.
 */
async function generateWithFal(prompt: string) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: "FAL_API_KEY not set. Set it in your environment to use fal.ai image generation.",
              alternative: "Provide a public image URL directly, or use a free image host like imgur.com.",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const res = await fetch("https://queue.fal.run/fal-ai/fast-sdxl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify({
      prompt: `Token logo: ${prompt}. Square format, centered, clean background, crypto token style.`,
      image_size: "square",
      num_images: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`fal.ai error: HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { images?: Array<{ url: string }> };
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error("No image returned from fal.ai");

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ imageUrl, provider: "fal", prompt }, null, 2),
      },
    ],
  };
}

/**
 * Generate image using Replicate.
 * @param prompt - Image description.
 * @returns MCP tool result with image URL.
 */
async function generateWithReplicate(prompt: string) {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: "REPLICATE_API_KEY not set. Set it in your environment to use Replicate image generation.",
              alternative: "Provide a public image URL directly, or use a free image host like imgur.com.",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "black-forest-labs/flux-schnell",
      input: {
        prompt: `Token logo: ${prompt}. Square format, centered, clean background, crypto token style.`,
        aspect_ratio: "1:1",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Replicate error: HTTP ${res.status}: ${text}`);
  }

  const prediction = (await res.json()) as { output?: string[]; urls?: { get: string } };

  /* Replicate returns immediately with a prediction ID; poll for result */
  if (prediction.urls?.get) {
    const imageUrl = await pollReplicate(prediction.urls.get, apiKey);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ imageUrl, provider: "replicate", prompt }, null, 2),
        },
      ],
    };
  }

  const imageUrl = prediction.output?.[0];
  if (!imageUrl) throw new Error("No image returned from Replicate");

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ imageUrl, provider: "replicate", prompt }, null, 2),
      },
    ],
  };
}

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

/**
 * Poll a Replicate prediction URL until completion.
 * @param url - The prediction status URL.
 * @param apiKey - Replicate API key.
 * @returns The generated image URL.
 */
async function pollReplicate(url: string, apiKey: string): Promise<string> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = (await res.json()) as { status: string; output?: string[]; error?: string };

    if (data.status === "succeeded" && data.output?.[0]) {
      return data.output[0];
    }
    if (data.status === "failed") {
      throw new Error(`Replicate prediction failed: ${data.error ?? "unknown"}`);
    }
  }
  throw new Error("Replicate prediction timed out");
}
