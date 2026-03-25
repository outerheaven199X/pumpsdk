/** Shared IPFS upload utilities for Pump.fun token metadata. */

import { IPFS_UPLOAD_URL } from "../utils/constants.js";

/** Response from the Pump.fun IPFS upload endpoint. */
interface IpfsResponse {
  metadataUri: string;
}

/**
 * Download an image from a URL and return it as a Blob with filename.
 * @param url - The public image URL.
 * @returns The image as a Blob with a derived filename.
 */
export async function downloadImage(url: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download image: HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const ext = url.split(".").pop()?.split("?")[0] ?? "png";
  return { blob, filename: `token-image.${ext}` };
}

/**
 * Upload token metadata and image to Pump.fun's IPFS endpoint.
 * @param params - Token metadata fields.
 * @returns The IPFS metadata URI.
 */
export async function uploadToIpfs(params: {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}): Promise<string> {
  const { blob, filename } = await downloadImage(params.imageUrl);

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("name", params.name);
  form.append("symbol", params.symbol);
  form.append("description", params.description);
  form.append("showName", "true");

  if (params.twitter) form.append("twitter", params.twitter);
  if (params.telegram) form.append("telegram", params.telegram);
  if (params.website) form.append("website", params.website);

  const res = await fetch(IPFS_UPLOAD_URL, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`IPFS upload failed: HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as IpfsResponse;
  return data.metadataUri;
}
