import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { calculateQuote } from "../utils/quote-calculator.js";
import { scrapeRacvQuote } from "../utils/racv-scraper.js";

const USE_LIVE_SCRAPER = process.env.RACV_LIVE_QUOTES === "true";

export const getMotorQuoteSchema = {
  vehicle_make: z.string().describe("Vehicle manufacturer (e.g. Toyota, Mazda, BMW)"),
  vehicle_model: z.string().describe("Vehicle model (e.g. Corolla, CX-5, 3 Series)"),
  vehicle_year: z.number().int().min(1990).max(2026).describe("Vehicle year of manufacture (1990-2026)"),
  postcode: z
    .string()
    .regex(/^3\d{3}$/, "Must be a 4-digit Victorian postcode starting with 3")
    .describe("Victorian postcode (4-digit, starting with 3)"),
  driver_age: z.number().int().min(17).max(99).describe("Primary driver's age (17-99)"),
  claims_last_5_years: z
    .number()
    .int()
    .min(0)
    .max(5)
    .default(0)
    .describe("Number of at-fault claims in the last 5 years (0-5)"),
  parking_type: z
    .enum(["garage", "carport", "street", "driveway"])
    .default("driveway")
    .describe("Where the vehicle is parked overnight"),
};

export function registerGetMotorQuote(server: McpServer) {
  server.tool(
    "get_motor_quote",
    "Get an indicative comprehensive motor insurance quote from RACV for a vehicle in Victoria. Returns estimated annual and monthly premiums, excess options, and coverage highlights. This is a non-binding indicative quote only.",
    getMotorQuoteSchema,
    async (params) => {
      const quoteInput = {
        vehicle_make: params.vehicle_make,
        vehicle_model: params.vehicle_model,
        vehicle_year: params.vehicle_year,
        postcode: params.postcode,
        driver_age: params.driver_age,
        claims_last_5_years: params.claims_last_5_years,
        parking_type: params.parking_type,
      };

      // Calculate mock quote as baseline
      const quote = calculateQuote(quoteInput);

      // Attempt live RACV website scraping if enabled
      let liveSource = false;
      if (USE_LIVE_SCRAPER) {
        try {
          console.log("[Quote] Attempting live RACV website scrape...");
          const scraped = await scrapeRacvQuote(quoteInput);
          if (scraped.success && scraped.annual_premium) {
            // Override mock premiums with real data
            const realAnnual = scraped.annual_premium;
            const spread = 0.05; // tighter range with real data
            quote.premium_range_annual = {
              min: Math.round(realAnnual * (1 - spread)),
              max: Math.round(realAnnual * (1 + spread)),
            };
            const realMonthly = scraped.monthly_premium || Math.round((realAnnual / 12) * 1.05);
            quote.premium_range_monthly = {
              min: Math.round(realMonthly * (1 - spread)),
              max: Math.round(realMonthly * (1 + spread)),
            };
            // Recalculate excess options based on real premium
            quote.excess_options = quote.excess_options.map((opt, i) => {
              const discounts = [0, 0.03, 0.07, 0.12];
              const discounted = Math.round(realAnnual * (1 - discounts[i]));
              return {
                ...opt,
                annual_premium: discounted,
                monthly_premium: Math.round((discounted / 12) * 1.05),
              };
            });
            liveSource = true;
            console.log(`[Quote] Live quote: $${realAnnual}/year`);
          } else {
            console.log("[Quote] Live scrape did not return premium, using mock data.");
          }
        } catch (err) {
          console.error("[Quote] Live scrape failed, using mock data:", err);
        }
      }

      const sourceNote = liveSource
        ? "(Based on RACV website pricing)"
        : "(Indicative estimate)";

      const textSummary = [
        `RACV Comprehensive Motor Insurance — Indicative Quote`,
        `Quote ID: ${quote.quote_id}`,
        ``,
        `Vehicle: ${quote.vehicle.year} ${quote.vehicle.make} ${quote.vehicle.model}`,
        `Estimated Market Value: $${quote.vehicle.estimated_value.toLocaleString()}`,
        ``,
        `Estimated Annual Premium: $${quote.premium_range_annual.min} – $${quote.premium_range_annual.max}`,
        `Estimated Monthly Premium: $${quote.premium_range_monthly.min} – $${quote.premium_range_monthly.max}/month`,
        ``,
        `Excess Options:`,
        ...quote.excess_options.map(
          (opt) =>
            `  • ${opt.label}: $${opt.annual_premium}/year ($${opt.monthly_premium}/month)`
        ),
        ``,
        `Coverage Includes:`,
        ...quote.coverage_summary.map((item) => `  ✓ ${item}`),
        ``,
        `RACV Member Discount: ${quote.member_discount_pct}% discount available for RACV members`,
        ``,
        `Quote valid until: ${quote.valid_until}`,
        ``,
        ...quote.disclaimers.map((d) => `⚠ ${d}`),
      ].join("\n");

      return {
        content: [{ type: "text", text: textSummary }],
        structuredContent: {
          type: "quote_result",
          data: quote,
        } as any,
      };
    }
  );
}
