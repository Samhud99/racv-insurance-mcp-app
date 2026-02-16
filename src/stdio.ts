import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetMotorQuote } from "./tools/get-motor-quote.js";
import { registerGetCoverage } from "./tools/get-coverage.js";
import { registerStartFullQuote } from "./tools/start-full-quote.js";

const server = new McpServer(
  {
    name: "racv-insurance-app",
    version: "1.0.0",
  },
  {
    capabilities: {
      logging: {},
    },
  }
);

registerGetMotorQuote(server);
registerGetCoverage(server);
registerStartFullQuote(server);

const transport = new StdioServerTransport();
await server.connect(transport);
