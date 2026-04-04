/** Shared constants for the PumpFun MCP server. */

export const PUMP_FRONTEND_API = "https://frontend-api-v3.pump.fun";
export const PUMPPORTAL_API_BASE = "https://pumpportal.fun/api";
export const IPFS_UPLOAD_URL = "https://pump.fun/api/ipfs";
export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMPSWAP_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const PUMP_FEES_PROGRAM_ID = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
export const SIGNING_PORT = 3142;
export const LAMPORTS_PER_SOL = 1_000_000_000;
/** Placeholder in claimersArray replaced with the connected wallet at signing time. */
export const WALLET_PLACEHOLDER = "__CONNECTED_WALLET__";
/** Only accept POST requests from the local signing page. */
export const ALLOWED_ORIGIN = `http://localhost:${SIGNING_PORT}`;
/** DexScreener API base URL for token listing and boost checks. */
export const DEXSCREENER_API_BASE = "https://api.dexscreener.com";
/** Byte length for CSRF token generation (produces 64-char hex string). */
export const CSRF_TOKEN_BYTES = 32;
