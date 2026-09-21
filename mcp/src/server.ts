#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { createClient } from "./client.ts";
import { runTool, toolDefinitions, type ToolContext } from "./tools.ts";

/**
 * The PriceLens MCP server (docs/mcp.md). It runs on the owner's own machine, speaks over stdin
 * and stdout, and reaches the admin API over HTTPS with a token from the environment. Nothing new
 * is opened on the server, and the token is never written to stdout, where it would land in the
 * agent's transcript.
 */

export const defaultOrigin = "https://admin.badumila.com";

export type Settings = { origin: string; token: string; canWrite: boolean };

/** What the environment says, or a clear complaint about what is missing. */
export function readSettings(environment: NodeJS.ProcessEnv = process.env): Settings | { error: string } {
  const token = environment.LPL_MCP_TOKEN?.trim();
  if (!token) return { error: "LPL_MCP_TOKEN is not set. Make a token in the admin under Distribution Channels and put it in the server's environment." };
  if (!token.startsWith("lpl_")) return { error: "LPL_MCP_TOKEN does not look like one of ours; they all start with lpl_." };
  const origin = environment.LPL_MCP_ORIGIN?.trim() || defaultOrigin;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { error: `LPL_MCP_ORIGIN is not an address: ${origin}.` };
  }
  // A token in plain http would travel readable across the network; localhost is the one place it cannot.
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    return { error: `LPL_MCP_ORIGIN must be an https address (or localhost while developing); got ${origin}.` };
  }
  // Reading is the default: a server nobody meant to arm cannot put anything on a public account.
  return { origin, token, canWrite: environment.LPL_MCP_WRITE === "1" || environment.LPL_MCP_WRITE === "true" };
}

export function buildServer(settings: Settings): Server {
  const server = new Server({ name: "lanka-pricelens", version: "0.1.0" }, { capabilities: { tools: {} } });
  const context: ToolContext = { client: createClient({ origin: settings.origin, token: settings.token }), canWrite: settings.canWrite };
  const definitions = toolDefinitions();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions.map((definition) => ({
      name: definition.name,
      // A tool that cannot run in this mode still appears, saying so, which is clearer than a gap.
      description: `${definition.description}${definition.writes && !settings.canWrite ? " (unavailable: this server is in reading mode)" : ""}`,
      inputSchema: definition.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = definitions.find((candidate) => candidate.name === request.params.name);
    if (!definition) return { content: [{ type: "text", text: `There is no tool called ${request.params.name}.` }], isError: true };
    return runTool(definition, context, (request.params.arguments ?? {}) as Record<string, unknown>);
  });

  return server;
}

async function main(): Promise<void> {
  const settings = readSettings();
  if ("error" in settings) {
    // stderr, not stdout: stdout is the protocol.
    console.error(`lanka-pricelens-mcp: ${settings.error}`);
    process.exit(1);
  }
  console.error(`lanka-pricelens-mcp: ${settings.origin}, ${settings.canWrite ? "changes allowed" : "reading only"}`);
  await buildServer(settings).connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
