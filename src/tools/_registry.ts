/** Central tool registry — registers all MCP tools on a single McpServer instance. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/* --- Trading --- */
import { registerQuote } from "./trading/quote.js";
import { registerTrade } from "./trading/trade.js";
import { registerOpenSigningPage } from "./trading/sign.js";

/* --- Tokens --- */
import { registerMetadata } from "./tokens/metadata.js";
import { registerNewMints } from "./tokens/new-mints.js";
import { registerLaunch } from "./tokens/launch.js";
import { registerOpenLaunchPage } from "./tokens/open-launch-page.js";
import { registerLaunchFeed } from "./tokens/launch-feed.js";
import { registerCreatorTokens } from "./tokens/creator-tokens.js";
import { registerRelaunch } from "./tokens/relaunch.js";

/* --- Fees --- */
import { registerClaimFees } from "./fees/claim.js";
import { registerClaimablePositions } from "./fees/positions.js";
import { registerClaimAllFees } from "./fees/claim-all.js";
import { registerFeeConfig } from "./fees/config-info.js";
import { registerComposeFeeConfig } from "./fees/compose.js";
import { registerPartnerConfig } from "./fees/partner.js";

/* --- Solana Utilities --- */
import { registerWalletBalance } from "./solana/balance.js";
import { registerTokenHoldings } from "./solana/holdings.js";
import { registerSendTransaction } from "./solana/send-tx.js";

/* --- Analytics --- */
import { registerTopTokens } from "./analytics/top-tokens.js";
import { registerLatestTrades } from "./analytics/latest-trades.js";
import { registerTokenHolders } from "./analytics/token-holders.js";
import { registerBondingCurveStatus } from "./analytics/bonding-curve.js";
import { registerDexscreenerCheck } from "./analytics/dexscreener-check.js";
import { registerDexscreenerOrders } from "./analytics/dexscreener-order.js";
import { registerDexscreenerProfile } from "./analytics/dexscreener-payment.js";

/* --- State --- */
import { registerPools } from "./state/pools.js";
import { registerPool } from "./state/pool.js";

/* --- Stream (WebSocket) --- */
import { registerStreamNewMints } from "./stream/subscribe-mints.js";
import { registerStreamTrades } from "./stream/subscribe-trades.js";
import { registerGraduationWatch } from "./stream/graduation-watch.js";

/* --- Scout --- */
import { registerScoutScan } from "./scout/scan.js";
import { registerScoutLaunch } from "./scout/launch.js";
import { registerGenerateTokenImage } from "./scout/generate-image.js";

/* --- Meta --- */
import { registerToolCatalog } from "./meta/catalog.js";
import { registerAgentBootstrap } from "./meta/agent-bootstrap.js";

/**
 * Register all MCP tools on the given server.
 * @param server - The McpServer instance to register tools on.
 */
export function registerAllTools(server: McpServer): void {
  /* Trading */
  registerQuote(server);
  registerTrade(server);
  registerOpenSigningPage(server);

  /* Tokens */
  registerMetadata(server);
  registerNewMints(server);
  registerLaunch(server);
  registerOpenLaunchPage(server);
  registerLaunchFeed(server);
  registerCreatorTokens(server);
  registerRelaunch(server);

  /* Fees */
  registerClaimFees(server);
  registerClaimablePositions(server);
  registerClaimAllFees(server);
  registerFeeConfig(server);
  registerComposeFeeConfig(server);
  registerPartnerConfig(server);

  /* Solana */
  registerWalletBalance(server);
  registerTokenHoldings(server);
  registerSendTransaction(server);

  /* Analytics */
  registerTopTokens(server);
  registerLatestTrades(server);
  registerTokenHolders(server);
  registerBondingCurveStatus(server);
  registerDexscreenerCheck(server);
  registerDexscreenerOrders(server);
  registerDexscreenerProfile(server);

  /* State */
  registerPools(server);
  registerPool(server);

  /* Stream */
  registerStreamNewMints(server);
  registerStreamTrades(server);
  registerGraduationWatch(server);

  /* Scout */
  registerScoutScan(server);
  registerScoutLaunch(server);
  registerGenerateTokenImage(server);

  /* Meta */
  registerToolCatalog(server);
  registerAgentBootstrap(server);
}
