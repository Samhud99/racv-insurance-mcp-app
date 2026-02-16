# RACV Insurance MCP App

An MCP (Model Context Protocol) server that provides indicative motor insurance quotes from RACV through AI platforms like ChatGPT, Claude, and Gemini.

Built as a V1 proof-of-concept to demonstrate AI platform distribution for Australian insurance.

## Features

- **Get Motor Quote** — indicative comprehensive car insurance premiums based on vehicle, driver, and location details
- **Coverage Details** — detailed information about inclusions, exclusions, optional extras, excess options, and claims process
- **Full Quote Handoff** — seamless redirect to racv.com.au to complete a bindable quote
- **Interactive Widgets** — RACV-branded HTML widgets that render inline in AI chat interfaces
- **Live Pricing (Optional)** — Playwright-based automation of the RACV website for real premium data

## Quick Start

```bash
npm install
npm run build
npm start
```

The MCP server will be available at `http://localhost:3000/mcp`.

### Development

```bash
npm run dev
```

### Testing the MCP endpoint

```bash
# Health check
curl http://localhost:3000/

# Initialize MCP session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "test", "version": "1.0.0" }
    }
  }'
```

## Architecture

```
src/
├── server.ts              # Express + MCP server (Streamable HTTP)
├── tools/
│   ├── get-motor-quote.ts # Quoting tool
│   ├── get-coverage.ts    # Coverage info tool
│   └── start-full-quote.ts# Handoff to racv.com.au
├── data/
│   ├── vehicles.json      # Make/model lookup (16 brands, 100+ models)
│   ├── postcodes.json     # Victorian postcode risk zones
│   └── pricing-rules.json # Premium calculation rules
└── utils/
    ├── quote-calculator.ts# Mock pricing engine
    └── racv-scraper.ts    # Playwright RACV website automation

public/
├── quote-result.html      # Quote display widget (RACV branded)
└── coverage-info.html     # Coverage details widget
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `RACV_LIVE_QUOTES` | `false` | Enable Playwright-based live quoting from racv.com.au |

## Live Quoting (Optional)

To enable real quotes from the RACV website:

```bash
npx playwright install chromium
RACV_LIVE_QUOTES=true npm start
```

This uses Playwright to automate the RACV quoting form at `my.racv.com.au`. Falls back to mock pricing if the scraper encounters any issues.

## Platform Integration

### ChatGPT
Point the ChatGPT Apps SDK to your deployed `/mcp` endpoint.

### Claude
Compatible with Claude MCP Apps via the same `/mcp` endpoint.

### Widgets
Quote result and coverage widgets are served from `/widget/` and render inside sandboxed iframes in AI chat interfaces.

## Regulatory Disclaimers

- All quotes are indicative only and not binding offers of insurance
- RACV Comprehensive Car Insurance is issued by Insurance Manufacturers of Australia Pty Ltd (IMA) ABN 93 004 208 084, AFS Licence No. 227678
- Refer to the PDS at racv.com.au/pds for full terms and conditions
- This app does not provide personal financial advice
