/**
 * What hosts actually receive in tools/list. The SDK converts Zod to JSON
 * Schema and emits `$ref` for a Zod instance that appears twice in one tool;
 * some hosts (Claude web/desktop chat) do not resolve `$ref` and then reject
 * valid arguments (estimate_swap `to` was "Expected object, received string").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOL_DEFINITIONS } from "./definitions.js";
import { registerTools } from "./index.js";

async function listWireTools() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

test("tools/list exposes every catalog tool without $ref in input schemas", async () => {
  const tools = await listWireTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    TOOL_DEFINITIONS.map((t) => t.name).sort(),
  );
  for (const tool of tools) {
    const json = JSON.stringify(tool.inputSchema);
    assert.ok(!json.includes('"$ref"'), `${tool.name}: input schema must be self-contained, got $ref`);
  }
});

test("swap tools describe `to` as a full inline object", async () => {
  const tools = await listWireTools();
  for (const name of ["estimate_swap", "execute_swap"]) {
    const tool = tools.find((t) => t.name === name)!;
    const props = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
    for (const side of ["from", "to"]) {
      assert.equal(props[side].type, "object", `${name}.${side}`);
      const inner = props[side].properties as Record<string, Record<string, unknown>>;
      assert.deepEqual(Object.keys(inner).sort(), ["address", "decimals", "network", "symbol"]);
      assert.deepEqual(props[side].required, ["network", "symbol"]);
    }
  }
});
