/** pump_partner_config — Manage partner/referral configurations for fee splits. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { getPartner, setPartner, listPartners } from "../../partner/store.js";

const DEFAULT_FEE_BPS = 2500;

const inputSchema = {
  action: z.enum(["get", "set", "list"]).describe("Action: 'get' one partner, 'set' create/update, or 'list' all"),
  partnerId: z.string().optional().describe("Partner identifier (required for get/set)"),
  walletAddress: z.string().optional().describe("Partner wallet address (required for set)"),
  feeBps: z.number().optional().describe("Fee allocation in basis points (default: 2500 = 25%)"),
  label: z.string().optional().describe("Human-readable label for this partner"),
};

/**
 * Register the pump_partner_config tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerPartnerConfig(server: McpServer) {
  server.tool(
    "pump_partner_config",
    "Manage partner/referral fee configurations. Partners get a share of creator fees from tokens launched through their config.",
    inputSchema,
    async ({ action, partnerId, walletAddress, feeBps, label }) => {
      try {
        if (action === "list") {
          const partners = await listPartners();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ partners, count: partners.length }, null, 2),
              },
            ],
          };
        }

        if (!partnerId) {
          return mcpError(new Error("partnerId is required for get/set actions."));
        }

        if (action === "get") {
          const partner = await getPartner(partnerId);
          if (!partner) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ found: false, partnerId }, null, 2),
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ found: true, partner }, null, 2),
              },
            ],
          };
        }

        if (!walletAddress) {
          return mcpError(new Error("walletAddress is required when setting a partner config."));
        }

        await setPartner({
          partnerId,
          walletAddress,
          feeBps: feeBps ?? DEFAULT_FEE_BPS,
          label: label ?? partnerId,
          createdAt: Date.now(),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  saved: true,
                  partnerId,
                  walletAddress,
                  feeBps: feeBps ?? DEFAULT_FEE_BPS,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
