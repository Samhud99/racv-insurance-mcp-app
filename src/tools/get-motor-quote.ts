import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const getMotorQuoteSchema = {
  rego: z
    .string()
    .min(1)
    .max(10)
    .describe("Vehicle registration number (Victorian number plate, e.g. 'ABC123')"),
  address: z
    .string()
    .min(5)
    .describe("Full street address in Victoria, e.g. '80 Bourke Street Melbourne'"),
  driver_age: z
    .number()
    .int()
    .min(17)
    .max(99)
    .describe("Primary driver's age (17-99)"),
  driver_gender: z
    .enum(["male", "female"])
    .describe("Primary driver's gender"),
  licence_age: z
    .number()
    .int()
    .min(16)
    .max(80)
    .describe("Age when the driver first obtained their licence"),
  claims_last_5_years: z
    .number()
    .int()
    .min(0)
    .max(5)
    .default(0)
    .describe("Number of at-fault claims in the last 5 years (0-5)"),
  is_racv_member: z
    .boolean()
    .default(false)
    .describe("Whether the driver is an RACV member"),
};

export function registerGetMotorQuote(server: McpServer) {
  server.tool(
    "get_motor_quote",
    "Get a REAL comprehensive motor insurance quote from the RACV website for a Victorian-registered vehicle. Uses the vehicle's registration number (rego) to look up the car, then fills out the RACV quote form with the driver's details to get an actual premium. This scrapes the live RACV website and returns real pricing — not estimates.",
    getMotorQuoteSchema,
    async (params) => {
      try {
        console.log(`[Quote] Starting live RACV quote for rego: ${params.rego}`);

        const { scrapeRacvQuote } = await import("../utils/racv-scraper.js");

        const result = await scrapeRacvQuote({
          rego: params.rego,
          address: params.address,
          driver_age: params.driver_age,
          driver_gender: params.driver_gender,
          licence_age: params.licence_age,
          claims_last_5_years: params.claims_last_5_years,
          is_racv_member: params.is_racv_member,
        });

        if (result.success) {
          const lines = [
            `RACV Comprehensive Motor Insurance Quote`,
            ``,
            `Vehicle: ${result.vehicle_description}`,
            ``,
          ];

          if (result.annual_premium) {
            lines.push(`Annual Premium: $${result.annual_premium.toLocaleString()}`);
          }
          if (result.monthly_premium) {
            lines.push(`Monthly Premium: $${result.monthly_premium.toLocaleString()}/month`);
          }
          if (result.excess_amount) {
            lines.push(`Standard Excess: $${result.excess_amount.toLocaleString()}`);
          }

          lines.push(
            ``,
            `Source: Live quote from RACV website (my.racv.com.au)`,
            `Note: This is a real indicative quote. Final pricing may vary when completing the full application on the RACV website.`,
          );

          if (result.raw_amounts && result.raw_amounts.length > 0) {
            lines.push(``, `All amounts found on quote page: ${result.raw_amounts.join(", ")}`);
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } else {
          // Quote failed - return error with context
          const errorLines = [
            `RACV Quote - Unable to Complete`,
            ``,
            `Vehicle: ${result.vehicle_description || "Not found"}`,
            `Step reached: ${result.step_reached || "unknown"}`,
            `Error: ${result.error}`,
          ];

          if (result.raw_amounts && result.raw_amounts.length > 0) {
            errorLines.push(``, `Amounts found on page: ${result.raw_amounts.join(", ")}`);
          }

          if (result.screenshot_path) {
            errorLines.push(``, `Screenshot saved to: ${result.screenshot_path}`);
          }

          return {
            content: [{ type: "text", text: errorLines.join("\n") }],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get RACV quote: ${error instanceof Error ? error.message : String(error)}\n\nThis tool requires Playwright and a browser to be available on the server. Make sure the server is running locally with Playwright installed.`,
            },
          ],
        };
      }
    }
  );
}
