/**
 * Drives one complete MCP session against an HTTP server, for packet capture.
 * Uses the project's own client, so what Wireshark records is the real host
 * talking to the real server, not a synthetic request.
 */
import { McpManager } from "../src/mcp/manager.js";

const url = process.argv[2];
const manager = new McpManager([{ name: "logistics-remote", type: "http", url }]);

await manager.connectAll();
console.log("connected:", JSON.stringify(manager.status()[0].serverInfo));

const track = await manager.callTool("logistics-remote__track_shipment", {
  tracking_number: "GT-4471",
});
console.log("track:", track.text.split("\n")[0]);

const quote = await manager.callTool("logistics-remote__quote_shipment", {
  origin: "Guatemala City",
  destination: "Flores",
  weight_kg: 8,
  service_level: "express",
});
console.log("quote:", quote.text.split("\n")[5]?.trim());

const missing = await manager.callTool("logistics-remote__track_shipment", {
  tracking_number: "GT-9999",
});
console.log("domain error:", missing.isError);

manager.close();
process.exit(0);
