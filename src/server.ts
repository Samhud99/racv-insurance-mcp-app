import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerGetMotorQuote } from "./tools/get-motor-quote.js";
import { registerGetCoverage } from "./tools/get-coverage.js";
import { registerStartFullQuote } from "./tools/start-full-quote.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

function createMcpServer(): McpServer {
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

  return server;
}

const app = express();

app.use(express.json());

app.use(
  cors({
    origin: [
      "https://chatgpt.com",
      "https://chat.openai.com",
      "https://claude.ai",
      "https://gemini.google.com",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Mcp-Session-Id",
      "Last-Event-ID",
    ],
    exposedHeaders: ["Mcp-Session-Id"],
    credentials: true,
  })
);

// Serve static UI widget files
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "../public");

app.use("/widget", express.static(publicDir));

// Health check
app.get("/", (_req, res) => {
  res.json({
    name: "racv-insurance-app",
    version: "1.0.0",
    status: "healthy",
    endpoints: {
      mcp: "/mcp",
      widgets: "/widget/",
      health: "/",
    },
  });
});

// Session storage
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST /mcp — primary communication channel
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
          log("info", "Session initialized", { sessionId: sid });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
          log("info", "Session closed", { sessionId: sid });
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided. Send an initialize request first.",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log("error", "Error handling POST /mcp", { error: String(error) });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET /mcp — SSE stream for server-to-client notifications
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid or missing session ID" },
      id: null,
    });
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// DELETE /mcp — session termination
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid or missing session ID" },
      id: null,
    });
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

// Structured JSON logging
function log(level: string, message: string, meta?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  log("info", "Shutting down...");
  for (const sid of Object.keys(transports)) {
    await transports[sid].close();
    delete transports[sid];
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  log("info", "Shutting down...");
  for (const sid of Object.keys(transports)) {
    await transports[sid].close();
    delete transports[sid];
  }
  process.exit(0);
});

app.listen(PORT, () => {
  log("info", `RACV Insurance MCP server running`, {
    port: PORT,
    endpoints: { mcp: "/mcp", widgets: "/widget/", health: "/" },
  });
  console.log(`\n  RACV Insurance MCP App`);
  console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`  Health check: http://localhost:${PORT}/`);
  console.log(`  Quote widget: http://localhost:${PORT}/widget/quote-result.html`);
  console.log();
});
