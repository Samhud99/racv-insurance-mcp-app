import { scrapeRacvQuote, closeBrowser } from "./racv-scraper.js";

const rego = process.argv[2] || process.env.TEST_REGO;
if (!rego) {
  console.error("Usage: npx tsx src/utils/test-live-quote.ts <REGO>");
  process.exit(1);
}

console.log(`Testing live quote for rego: ${rego}\n`);

const result = await scrapeRacvQuote({
  rego,
  address: "80 Bourke Street Melbourne",
  driver_age: 35,
  driver_gender: "male",
  licence_age: 18,
  claims_last_5_years: 0,
  is_racv_member: false,
});

console.log("\n=== RESULT ===");
console.log(JSON.stringify(result, null, 2));

await closeBrowser();
