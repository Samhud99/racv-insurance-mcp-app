# RACV Insurance MCP App

## Project Overview
MCP server providing indicative motor insurance quotes from RACV for AI platforms (ChatGPT, Claude, Gemini).

## Tech Stack
- **Runtime**: Node.js 20+ / TypeScript (ESM)
- **MCP SDK**: @modelcontextprotocol/sdk with Streamable HTTP transport
- **HTTP**: Express.js with CORS
- **Validation**: Zod schemas on all tool inputs
- **Browser Automation**: Playwright (optional, for live RACV website quotes)
- **UI**: Vanilla HTML/CSS/JS widgets in `/public/`

## Key Commands
- `npm run build` — compile TypeScript + copy data files to dist/
- `npm start` — run production server
- `npm run dev` — run with tsx watch (hot reload)

## Architecture
- `src/server.ts` — Express + MCP server setup, Streamable HTTP on /mcp
- `src/tools/` — MCP tool handlers (get-motor-quote, get-coverage, start-full-quote)
- `src/utils/quote-calculator.ts` — mock pricing engine
- `src/utils/racv-scraper.ts` — Playwright-based RACV website automation (opt-in via RACV_LIVE_QUOTES=true)
- `src/data/` — vehicle database, postcode risk zones, pricing rules
- `public/` — HTML widgets rendered in AI platform chat interfaces

## Environment Variables
- `PORT` — server port (default: 3000)
- `RACV_LIVE_QUOTES` — set to "true" to enable Playwright-based live quoting from racv.com.au

## MCP Tools
1. `get_motor_quote` — returns indicative premium for a vehicle in Victoria
2. `get_coverage_details` — returns coverage inclusions, exclusions, extras, claims process
3. `start_full_quote` — generates handoff link to racv.com.au with UTM parameters
