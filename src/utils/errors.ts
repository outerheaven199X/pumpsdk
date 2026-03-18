/** Standardized MCP error responses for tool handlers. */

/**
 * Wrap an error into an MCP-compatible error response.
 * @param error - The caught error or unknown value.
 * @returns MCP tool result with isError flag.
 */
export function mcpError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
