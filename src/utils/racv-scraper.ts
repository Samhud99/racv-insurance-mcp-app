import { chromium, Browser, Page } from "playwright";

export interface RacvScraperInput {
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  postcode: string;
  driver_age: number;
  claims_last_5_years: number;
  parking_type: "garage" | "carport" | "street" | "driveway";
}

export interface RacvScraperResult {
  success: boolean;
  source: "racv_website" | "mock";
  annual_premium?: number;
  monthly_premium?: number;
  excess_standard?: number;
  screenshot_path?: string;
  error?: string;
  raw_text?: string;
}

const RACV_URL = "https://my.racv.com.au/s/motor-insurance?p=CAR";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Select an option from a native <select> by matching the label text.
 * Returns true if a match was found.
 */
async function selectByLabel(
  page: Page,
  selectLocator: ReturnType<Page["locator"]>,
  searchText: string
): Promise<boolean> {
  // Get all options and find the best match
  const options = await selectLocator.locator("option").all();
  for (const opt of options) {
    const text = await opt.textContent();
    if (
      text &&
      text.trim().toLowerCase().includes(searchText.toLowerCase())
    ) {
      const value = await opt.getAttribute("value");
      if (value) {
        await selectLocator.selectOption(value);
        return true;
      }
    }
  }
  return false;
}

/**
 * Attempts to get a real insurance quote from the RACV website using Playwright.
 * Automates the multi-step quoting form at my.racv.com.au.
 *
 * Form flow:
 * 1. YOUR CAR: Year → Make → Model → Body Type (cascading <select> dropdowns)
 * 2. ABOUT YOU: Postcode, DOB, parking, licence, claims
 * 3. CUSTOMISE COVER: Excess selection → premium result
 */
export async function scrapeRacvQuote(
  input: RacvScraperInput
): Promise<RacvScraperResult> {
  let page: Page | null = null;

  try {
    const b = await getBrowser();
    page = await b.newPage({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    // Block only ad/tracking domains (not analytics needed by Salesforce)
    await page.route(
      /\.(doubleclick\.net|googleads\.g\.doubleclick|adsrvr\.org|facebook\.net)\//,
      (route) => route.abort()
    );

    console.log("[RACV Scraper] Navigating to quote page...");
    await page.goto(RACV_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    // Wait for Salesforce Aura/LWC to render
    await page.waitForTimeout(8000);

    // ── Step 1: Click "Find your car manually" ──
    console.log("[RACV Scraper] Clicking 'Find your car manually'...");
    const manualLink = page.getByText("Find your car manually");
    await manualLink.waitFor({ timeout: 10000 });
    await manualLink.click();
    await page.waitForTimeout(3000);

    // ── Step 2: Fill vehicle details (cascading selects) ──
    // Order: Year → Make → Model → Body Type
    console.log("[RACV Scraper] Selecting year...");

    // Year select
    const yearSelect = page.locator("select[name='year']");
    if (await yearSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await yearSelect.selectOption(String(input.vehicle_year));
      await page.waitForTimeout(2000); // Wait for make options to load
    } else {
      // Try aria-label fallback
      const yearAlt = page.getByLabel(/year/i).first();
      await yearAlt.selectOption(String(input.vehicle_year));
      await page.waitForTimeout(2000);
    }

    console.log("[RACV Scraper] Selecting make...");
    // Make select (populated after year is selected)
    const makeSelect = page.locator("select[name='make']");
    if (await makeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      const found = await selectByLabel(page, makeSelect, input.vehicle_make);
      if (!found) {
        console.log(`[RACV Scraper] Make "${input.vehicle_make}" not found in dropdown`);
        await page.screenshot({ path: "/tmp/racv-make-options.png", fullPage: true });
        // Log available options for debugging
        const opts = await makeSelect.locator("option").allTextContents();
        console.log("[RACV Scraper] Available makes:", opts.slice(0, 20).join(", "));
      }
      await page.waitForTimeout(2000); // Wait for model options to load
    }

    console.log("[RACV Scraper] Selecting model...");
    // Model select (populated after make is selected)
    const modelSelect = page.locator("select[name='model']");
    if (await modelSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      const found = await selectByLabel(page, modelSelect, input.vehicle_model);
      if (!found) {
        console.log(`[RACV Scraper] Model "${input.vehicle_model}" not found in dropdown`);
        const opts = await modelSelect.locator("option").allTextContents();
        console.log("[RACV Scraper] Available models:", opts.slice(0, 20).join(", "));
      }
      await page.waitForTimeout(2000); // Wait for body type options to load
    }

    console.log("[RACV Scraper] Selecting body type...");
    // Body Type select (populated after model is selected)
    const bodySelect = page.locator("select[name='bodyType']").or(
      page.locator("select").filter({ hasText: /body type/i })
    );
    if (await bodySelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Select the first non-placeholder option
      const opts = await bodySelect.locator("option").all();
      for (const opt of opts) {
        const val = await opt.getAttribute("value");
        const text = await opt.textContent();
        if (val && val.trim() && text && !text.trim().toLowerCase().includes("body type")) {
          await bodySelect.selectOption(val);
          break;
        }
      }
      await page.waitForTimeout(1500);
    }

    await page.screenshot({ path: "/tmp/racv-step2-filled.png", fullPage: true });
    console.log("[RACV Scraper] Vehicle details selected.");

    // Wait for car variant list to appear (specific engine/transmission options)
    console.log("[RACV Scraper] Waiting for car variant list...");
    await page.waitForTimeout(4000);

    // The RACV form shows a list of specific car variants after body type selection.
    // Each variant is a clickable row. Select the first one.
    const variantRows = page.locator("table tr, [role='row'], [role='option'], .car-details-row, [data-row-key-value]").or(
      page.locator("div").filter({ hasText: /FUEL INJECTION|HYBRID|TURBO|PETROL|DIESEL/i })
    );
    const variantCount = await variantRows.count();
    if (variantCount > 0) {
      console.log(`[RACV Scraper] Found ${variantCount} car variants. Selecting first one...`);
      // Click the first variant that looks like a car description
      for (let i = 0; i < Math.min(variantCount, 10); i++) {
        const row = variantRows.nth(i);
        const text = await row.textContent().catch(() => "");
        if (text && (text.includes("FUEL") || text.includes("HYBRID") || text.includes("TURBO") || text.includes("PETROL") || text.includes("DIESEL") || text.includes("CC"))) {
          console.log(`[RACV Scraper] Clicking variant: ${text.trim().slice(0, 80)}...`);
          await row.click();
          await page.waitForTimeout(5000);
          break;
        }
      }
    } else {
      // Try finding clickable radio buttons or list items
      const radioItems = page.locator("input[type='radio']");
      if (await radioItems.count() > 0) {
        await radioItems.first().click();
        await page.waitForTimeout(3000);
      }
    }

    await page.screenshot({ path: "/tmp/racv-step2b-variant.png", fullPage: true });

    // Look for Next/Continue button
    const nextBtn = page.getByRole("button", { name: /next|continue/i });
    if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(4000);
    }

    await page.screenshot({ path: "/tmp/racv-step3.png", fullPage: true });

    // ── Step 3: Fill "About You" section ──
    console.log("[RACV Scraper] Filling 'About You' section...");

    // Calculate DOB from age (use 1 January for simplicity)
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - input.driver_age;

    // Postcode
    const postcodeInput = page.locator("input[name*='postcode' i]").or(
      page.getByPlaceholder(/postcode/i)
    ).or(page.getByLabel(/postcode/i));
    if (await postcodeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await postcodeInput.fill(input.postcode);
      await page.waitForTimeout(1500);
      // May need to select from autocomplete
      const suggestion = page.getByRole("option").first();
      if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
        await suggestion.click();
      }
      await page.waitForTimeout(500);
    }

    // Date of birth — may be separate day/month/year fields or a single input
    const dobInput = page.locator("input[name*='dob' i]").or(
      page.locator("input[name*='dateOfBirth' i]")
    ).or(page.getByPlaceholder(/date of birth|dd\/mm\/yyyy/i));
    if (await dobInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dobInput.fill(`01/01/${birthYear}`);
      await page.waitForTimeout(500);
    } else {
      // Try separate fields
      const dayInput = page.locator("input[name*='day' i]").or(page.getByPlaceholder(/dd/i));
      const monthInput = page.locator("input[name*='month' i]").or(page.getByPlaceholder(/mm/i));
      const yearDobInput = page.locator("input[name*='year' i]").last().or(page.getByPlaceholder(/yyyy/i));
      if (await dayInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await dayInput.fill("01");
        await monthInput.fill("01");
        await yearDobInput.fill(String(birthYear));
        await page.waitForTimeout(500);
      }
    }

    // Parking type — may be radio buttons or a select
    const parkingMap: Record<string, string[]> = {
      garage: ["garage", "locked garage"],
      carport: ["carport"],
      driveway: ["driveway", "own property"],
      street: ["street", "on street", "kerbside"],
    };
    const parkingTerms = parkingMap[input.parking_type] || [input.parking_type];

    const parkingSelect = page.locator("select[name*='parking' i]").or(
      page.getByLabel(/park/i)
    );
    if (await parkingSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      for (const term of parkingTerms) {
        if (await selectByLabel(page, parkingSelect, term)) break;
      }
    }

    // Claims
    const claimsSelect = page.locator("select[name*='claim' i]").or(
      page.getByLabel(/claim/i)
    );
    if (await claimsSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await selectByLabel(page, claimsSelect, String(input.claims_last_5_years));
    }

    await page.screenshot({ path: "/tmp/racv-step3-filled.png", fullPage: true });

    // Click next/continue to get quote
    const nextBtn2 = page.getByRole("button", {
      name: /next|continue|get.*(quote|estimate)|calculate/i,
    });
    if (await nextBtn2.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn2.click();
      await page.waitForTimeout(6000);
    }

    await page.screenshot({ path: "/tmp/racv-step4.png", fullPage: true });

    // ── Step 4: Extract premium ──
    console.log("[RACV Scraper] Extracting premium...");

    // Wait a bit more for quote calculation
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "/tmp/racv-result.png", fullPage: true });

    // Extract all text and look for dollar amounts
    const pageContent = await page.textContent("body");

    // Look for premium patterns
    const premiumPatterns = [
      /\$([\d,]+(?:\.\d{2})?)\s*(?:per\s*year|\/\s*year|annually|p\.a\.|pa|\/yr)/i,
      /(?:annual|yearly)\s*(?:premium|price|cost)[:\s]*\$([\d,]+(?:\.\d{2})?)/i,
      /(?:estimated|indicative|your)\s*(?:premium|price|quote)[:\s]*\$([\d,]+(?:\.\d{2})?)/i,
    ];

    const monthlyPatterns = [
      /\$([\d,]+(?:\.\d{2})?)\s*(?:per\s*month|\/\s*month|monthly|p\.m\.|pm|\/mo)/i,
      /(?:monthly)\s*(?:premium|price|cost)[:\s]*\$([\d,]+(?:\.\d{2})?)/i,
    ];

    let annualPremium: number | undefined;
    let monthlyPremium: number | undefined;

    for (const pattern of premiumPatterns) {
      const match = pageContent?.match(pattern);
      if (match) {
        annualPremium = parseFloat(match[1].replace(/,/g, ""));
        break;
      }
    }

    for (const pattern of monthlyPatterns) {
      const match = pageContent?.match(pattern);
      if (match) {
        monthlyPremium = parseFloat(match[1].replace(/,/g, ""));
        break;
      }
    }

    // If no labeled premium found, look for prominent dollar amounts (likely the quote)
    if (!annualPremium && !monthlyPremium) {
      const allAmounts =
        pageContent?.match(/\$([\d,]+(?:\.\d{2})?)/g) || [];
      const numericAmounts = allAmounts
        .map((a) => parseFloat(a.replace(/[$,]/g, "")))
        .filter((n) => n > 200 && n < 10000) // reasonable insurance range
        .sort((a, b) => b - a);

      if (numericAmounts.length > 0) {
        // Assume the largest reasonable amount is the annual premium
        annualPremium = numericAmounts[0];
        console.log(`[RACV Scraper] Inferred annual premium: $${annualPremium} (from dollar amounts on page)`);
      }
    }

    if (annualPremium || monthlyPremium) {
      console.log(
        `[RACV Scraper] Found premium: annual=$${annualPremium}, monthly=$${monthlyPremium}`
      );
      return {
        success: true,
        source: "racv_website",
        annual_premium: annualPremium,
        monthly_premium: monthlyPremium,
        screenshot_path: "/tmp/racv-result.png",
      };
    }

    console.log("[RACV Scraper] Could not find premium on page.");
    return {
      success: false,
      source: "racv_website",
      error:
        "Could not extract premium from page. The form may require additional fields or encountered an error. Screenshots saved for debugging.",
      raw_text: pageContent?.slice(0, 1000),
      screenshot_path: "/tmp/racv-result.png",
    };
  } catch (error) {
    console.error("[RACV Scraper] Error:", error);
    if (page) {
      await page
        .screenshot({ path: "/tmp/racv-error.png", fullPage: true })
        .catch(() => {});
    }
    return {
      success: false,
      source: "mock",
      error: `Scraper error: ${error instanceof Error ? error.message : String(error)}`,
      screenshot_path: "/tmp/racv-error.png",
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
