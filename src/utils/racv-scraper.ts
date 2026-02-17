import { chromium, Browser, Page, BrowserContext } from "playwright";

export interface RacvQuoteInput {
  rego: string;
  address: string;         // Full street address e.g. "80 Bourke Street, Melbourne VIC 3000"
  driver_age: number;
  driver_gender: "male" | "female";
  licence_age: number;     // Age when licence was obtained
  claims_last_5_years: number;
  is_racv_member?: boolean;
  under_finance?: boolean;
  purpose?: "Private" | "Business use & not registered for GST" | "Business use & registered for GST";
}

export interface RacvQuoteResult {
  success: boolean;
  vehicle_description?: string;
  annual_premium?: number;
  monthly_premium?: number;
  excess_amount?: number;
  raw_amounts?: string[];
  screenshot_path?: string;
  error?: string;
  step_reached?: string;
}

interface VehicleInfo {
  year: string;
  make: string;
  model: string;
  bodyType: string;
  variant: string;
  description: string;
}

const RACV_URL = "https://my.racv.com.au/s/motor-insurance?p=CAR";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: false,
      slowMo: 100,
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
 * Type into a Salesforce LWC input field using keyboard events.
 * Playwright's fill() bypasses LWC data binding, so we must use real keyboard input.
 */
async function lwcType(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector);
  await field.click({ force: true });
  await page.waitForTimeout(200);
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(100);
  await page.keyboard.type(value, { delay: 50 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
}

/**
 * Click a Salesforce LWC radio button with proper event dispatching.
 */
async function lwcRadioClick(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector);
  if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
    await el.click({ force: true });
    await page.waitForTimeout(300);
    await el.dispatchEvent("change");
    await page.waitForTimeout(200);
  }
}

/**
 * Extract vehicle info from RACV Aura API response.
 * RACV makes two calls: rego lookup (usually succeeds) and HUON info (often fails).
 * We capture data from the successful rego lookup even when HUON fails.
 */
function extractVehicleFromAuraResponse(responseBody: string): VehicleInfo | null {
  try {
    const data = JSON.parse(responseBody);
    const action = data?.actions?.[0];
    if (action?.state !== "SUCCESS") return null;

    const returnStr = action?.returnValue?.returnValue?.returnValue;
    if (!returnStr || typeof returnStr !== "string") return null;

    const parsed = JSON.parse(returnStr);
    const vehicle = parsed?.vehicles?.[0]?.vehicle;
    if (!vehicle) return null;

    return {
      year: vehicle.yearCreate || "",
      make: vehicle.makeName || vehicle.make || "",
      model: vehicle.familyName || vehicle.model || "",
      bodyType: vehicle.bodyStyleName || vehicle.bodyStyle || "",
      variant: vehicle.variantName || "",
      description: `${vehicle.yearCreate || ""} ${(vehicle.makeName || "").toUpperCase()} ${vehicle.familyName || ""} ${vehicle.variantName || ""}`.trim(),
    };
  } catch {
    return null;
  }
}

export async function scrapeRacvQuote(input: RacvQuoteInput): Promise<RacvQuoteResult> {
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  try {
    const b = await getBrowser();
    context = await b.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();

    await page.route(
      /\.(doubleclick\.net|googleads|adsrvr\.org|facebook\.net)\//,
      (route) => route.abort()
    );

    // Capture vehicle data from Aura API responses
    // Using object wrapper so TS can track mutations from async callbacks
    const captured: { vehicle: VehicleInfo | null } = { vehicle: null };
    page.on("response", async (res) => {
      try {
        if (res.url().includes("/aura?") && res.url().includes("ApexAction.execute")) {
          const body = await res.text();
          if (body.includes("vehicles") || body.includes("yearCreate")) {
            const vehicle = extractVehicleFromAuraResponse(body);
            if (vehicle && vehicle.year && vehicle.make) {
              captured.vehicle = vehicle;
              console.log(`[RACV] API captured vehicle: ${vehicle.description}`);
            }
          }
        }
      } catch {
        // Response body may not be available
      }
    });

    // ── STEP 1: Navigate & rego lookup ──
    console.log("[RACV] Navigating to quote page...");
    await page.goto(RACV_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(10000);

    let vehicleDesc = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[RACV] Entering rego (attempt ${attempt})...`);

      if (attempt > 1) {
        // Check if "Search by Registration instead" link exists
        const regoLink = page.locator("a, button").filter({ hasText: /search by registration/i });
        if (await regoLink.isVisible({ timeout: 2000 }).catch(() => false)) {
          await regoLink.click();
          await page.waitForTimeout(3000);
        } else {
          await page.goto(RACV_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(10000);
        }
      }

      // Type rego using keyboard events (fill() bypasses LWC data binding)
      const regoField = page.locator("input[name='rego']");
      await regoField.waitFor({ timeout: 10000 });
      await regoField.click({ force: true });
      await page.waitForTimeout(300);
      await page.keyboard.press("Meta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(input.rego, { delay: 80 });
      await page.waitForTimeout(500);

      // Click Find Your car and capture API response
      const findBtn = page.locator("button").filter({ hasText: /Find/i });
      await findBtn.scrollIntoViewIfNeeded();

      // Set up response capture BEFORE clicking
      const responsePromise = page.waitForResponse(
        (res) => res.url().includes("/aura?") && res.url().includes("ApexAction.execute"),
        { timeout: 20000 }
      ).then(async (res) => {
        try {
          const body = await res.text();
          const vehicle = extractVehicleFromAuraResponse(body);
          if (vehicle && vehicle.year && vehicle.make) {
            captured.vehicle = vehicle;
            console.log(`[RACV] API captured vehicle: ${vehicle.description}`);
          }
        } catch {}
      }).catch(() => {});

      await findBtn.click();
      console.log("[RACV] Clicked Find Your car, waiting...");

      // Wait for at least one API response
      await responsePromise;

      // Wait for result
      let found = false;
      let notFoundMsg = false;
      for (let wait = 0; wait < 25; wait++) {
        await page.waitForTimeout(1000);

        // Check if address field appeared (auto rego lookup succeeded)
        const addressField = page.locator("input[name='addressSearch']");
        if (await addressField.isVisible().catch(() => false)) {
          const bodyText = await page.textContent("body") || "";
          const carMatch = bodyText.match(/(\d{4}\s+[A-Z][A-Z0-9\s]+(?:\([^)]+\))?)/);
          vehicleDesc = carMatch ? carMatch[1].trim() : (captured.vehicle ? captured.vehicle.description : "Vehicle found");
          found = true;
          break;
        }

        // Check for car heading
        const headings = await page.locator("h1, h2, h3, h4, h5").allTextContents();
        for (const h of headings) {
          if (/\d{4}\s+[A-Z]{2,}/.test(h.trim())) {
            vehicleDesc = h.trim();
            found = true;
            break;
          }
        }
        if (found) break;

        // Check for "couldn't find" via body text (more reliable than locator)
        const bodyText = await page.textContent("body") || "";
        if (/couldn.t find a vehicle|could not find a vehicle/i.test(bodyText)) {
          console.log("[RACV] RACV couldn't find vehicle message detected");
          notFoundMsg = true;
          break;
        }
      }

      if (found) {
        console.log(`[RACV] Found: ${vehicleDesc}`);
        break;
      }

      // Wait a moment for async response handler to complete
      await page.waitForTimeout(2000);
      console.log(`[RACV] Captured vehicle data: ${captured.vehicle ? captured.vehicle.description : "none"}`);

      // HUON failure fallback: use manual search with captured vehicle data
      const cv = captured.vehicle; // local for TS narrowing
      if (notFoundMsg && cv) {
        console.log(`[RACV] HUON failed but API has vehicle data. Using manual search...`);
        console.log(`[RACV] Vehicle from API: ${cv.description}`);

        // Fill Year (should already be pre-filled from partial rego match)
        const yearSelect = page.locator("select").filter({ hasText: /2011|2012|2010/ }).first();
        const yearSelectByName = page.locator("select[name*='year' i], select[name*='Year']");
        const yearEl = await yearSelectByName.count() > 0 ? yearSelectByName.first() : yearSelect;
        if (await yearEl.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Try to select the year
          try {
            await yearEl.selectOption(cv.year);
            await page.waitForTimeout(1500);
          } catch {
            // Year might already be selected
          }
        }

        // Fill Make
        const makeSelects = page.locator("select:visible");
        const makeCount = await makeSelects.count();
        for (let i = 0; i < makeCount; i++) {
          const sel = makeSelects.nth(i);
          const options = await sel.locator("option").allTextContents();
          const makeOption = options.find(o =>
            o.toUpperCase().includes(cv.make.toUpperCase()) ||
            cv.make.toUpperCase().includes(o.toUpperCase().trim())
          );
          if (makeOption && makeOption.trim()) {
            console.log(`[RACV] Selecting make: ${makeOption.trim()}`);
            await sel.selectOption({ label: makeOption.trim() });
            await page.waitForTimeout(2000);
            break;
          }
        }

        // Fill Model (dropdown reloads after Make selection)
        await page.waitForTimeout(1000);
        const modelSelects = page.locator("select:visible");
        const modelCount = await modelSelects.count();
        for (let i = 0; i < modelCount; i++) {
          const sel = modelSelects.nth(i);
          const options = await sel.locator("option").allTextContents();
          const modelOption = options.find(o =>
            o.toUpperCase().includes(cv.model.toUpperCase()) ||
            cv.model.toUpperCase().includes(o.toUpperCase().trim())
          );
          if (modelOption && modelOption.trim()) {
            console.log(`[RACV] Selecting model: ${modelOption.trim()}`);
            await sel.selectOption({ label: modelOption.trim() });
            await page.waitForTimeout(2000);
            break;
          }
        }

        // Fill Body Type
        await page.waitForTimeout(1000);
        const bodySelects = page.locator("select:visible");
        const bodyCount = await bodySelects.count();
        for (let i = 0; i < bodyCount; i++) {
          const sel = bodySelects.nth(i);
          const options = await sel.locator("option").allTextContents();
          // Look for body type match (STATION WAGON, SEDAN, HATCHBACK, SUV etc.)
          const bodyOption = options.find(o => {
            const upper = o.toUpperCase().trim();
            return upper.includes(cv.bodyType.toUpperCase()) ||
                   cv.bodyType.toUpperCase().includes(upper);
          });
          if (bodyOption && bodyOption.trim()) {
            console.log(`[RACV] Selecting body type: ${bodyOption.trim()}`);
            await sel.selectOption({ label: bodyOption.trim() });
            await page.waitForTimeout(2000);
            break;
          }
        }

        await page.screenshot({ path: "/tmp/racv-manual-search.png", fullPage: true });

        // Click Search/Find button after manual fill
        const searchBtn = page.locator("button:visible").filter({ hasText: /search|find/i });
        if (await searchBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await searchBtn.first().click();
          console.log("[RACV] Clicked manual search, waiting...");
          await page.waitForTimeout(10000);
        }

        // Check if we now have the car details / address field
        const addressField = page.locator("input[name='addressSearch']");
        if (await addressField.isVisible({ timeout: 10000 }).catch(() => false)) {
          vehicleDesc = cv.description;
          console.log(`[RACV] Manual search succeeded: ${vehicleDesc}`);
          break;
        }

        // Check for variant selection (multiple matching vehicles)
        const variantHeadings = await page.locator("h2, h3, h4").allTextContents();
        for (const h of variantHeadings) {
          if (/\d{4}\s+[A-Z]{2,}/.test(h.trim())) {
            vehicleDesc = h.trim();
            console.log(`[RACV] Variant selection page: ${vehicleDesc}`);
            break;
          }
        }
        if (vehicleDesc) break;

        await page.screenshot({ path: `/tmp/racv-manual-${attempt}.png`, fullPage: true });
      }

      console.log(`[RACV] Attempt ${attempt} failed`);
    }

    if (!vehicleDesc) {
      await page.screenshot({ path: "/tmp/racv-not-found.png", fullPage: true });
      return {
        success: false,
        error: `Could not find a vehicle with registration ${input.rego} after multiple attempts. RACV's lookup service may be temporarily unavailable.`,
        step_reached: "rego_lookup",
        screenshot_path: "/tmp/racv-not-found.png",
      };
    }

    // ── STEP 2: YOUR CAR details ──
    console.log("[RACV] Filling car details...");

    // Address
    const addrInput = page.locator("input[name='addressSearch']");
    await addrInput.click({ force: true });
    await page.waitForTimeout(200);
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(input.address, { delay: 60 });
    await page.waitForTimeout(3000);

    // Select first autocomplete suggestion
    const suggestion = page.locator("[role='option'], [role='listbox'] li, .slds-listbox__option, ul li")
      .filter({ hasText: new RegExp(input.address.split(" ")[0], "i") });
    if (await suggestion.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await suggestion.first().click();
      await page.waitForTimeout(1000);
    }

    // Finance: No
    await lwcRadioClick(page, "input[name='UnderFinance'][value='No']");

    // Purpose: Private
    const purposeSelect = page.locator("select[name='Purpose']");
    if (await purposeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await purposeSelect.selectOption(input.purpose || "Private");
      await page.waitForTimeout(300);
    }

    // Business name: No
    await lwcRadioClick(page, "input[name='vehicleRegisterInBusinessName'][value='No']");

    // Click Continue
    console.log("[RACV] Proceeding to About You...");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    const continueBtn1 = page.locator("button").filter({ hasText: /Continue/i });
    await continueBtn1.scrollIntoViewIfNeeded();
    await continueBtn1.click({ timeout: 10000 });
    await page.waitForTimeout(6000);

    // Check for address error
    const errTexts = await page.locator("[class*='error']:visible").allTextContents();
    if (errTexts.some(e => /address/i.test(e))) {
      return {
        success: false,
        vehicle_description: vehicleDesc,
        error: "Could not validate the address. Please provide a valid Victorian street address.",
        step_reached: "your_car",
      };
    }

    await page.screenshot({ path: "/tmp/racv-step2-done.png", fullPage: true });

    // ── STEP 3: ABOUT YOU ──
    console.log("[RACV] Filling About You...");

    // RACV Member
    if (input.is_racv_member) {
      await lwcRadioClick(page, "input[name='isMember0'][value='Yes']");
    } else {
      await lwcRadioClick(page, "input[name='isMember0'][value='No']");
    }

    // Gender
    const genderValue = input.driver_gender === "male" ? "Male" : "Female";
    await lwcRadioClick(page, `input[name='driverSex0'][value='${genderValue}']`);

    // Age
    const ageInput = page.locator("input[name='age0']");
    if (await ageInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lwcType(page, "input[name='age0']", String(input.driver_age));
    }

    // Licence age
    const licenceInput = page.locator("input[name='driverAge0']");
    if (await licenceInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lwcType(page, "input[name='driverAge0']", String(input.licence_age));
    }

    // Claims
    if (input.claims_last_5_years === 0) {
      await lwcRadioClick(page, "input[name='hasClaims0'][value='No']");
    } else {
      await lwcRadioClick(page, "input[name='hasClaims0'][value='Yes']");
      await page.waitForTimeout(500);
      const claimsCountSelect = page.locator("select[name*='claim' i]");
      if (await claimsCountSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await claimsCountSelect.selectOption(String(input.claims_last_5_years));
        await page.waitForTimeout(300);
      }
    }

    await page.screenshot({ path: "/tmp/racv-step3-filled.png", fullPage: true });

    // Click Continue to get quote
    console.log("[RACV] Getting quote...");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    const continueBtn2 = page.locator("button").filter({ hasText: /Continue/i });
    await continueBtn2.scrollIntoViewIfNeeded();
    await continueBtn2.click({ timeout: 10000 });

    // Wait for the quote to load (with system error retry)
    console.log("[RACV] Waiting for quote calculation...");
    let quoteLoaded = false;
    for (let quoteAttempt = 0; quoteAttempt < 2; quoteAttempt++) {
      try {
        await page.locator("text=/\\$\\d/").first().waitFor({ timeout: 60000 });
        quoteLoaded = true;
        console.log("[RACV] Quote loaded!");
        break;
      } catch {
        console.log("[RACV] Timeout waiting for quote, checking page state...");
      }
      await page.waitForTimeout(2000);

      // Check for system error
      const bodyCheck = await page.textContent("body") || "";
      if (/system error|technical problem/i.test(bodyCheck)) {
        console.log("[RACV] System error detected, clicking BACK TO FORM...");
        const backBtn = page.locator("button, a").filter({ hasText: /back to form/i });
        if (await backBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await backBtn.click();
          await page.waitForTimeout(5000);
          // Re-submit the form
          const retryBtn = page.locator("button").filter({ hasText: /Continue/i });
          if (await retryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await retryBtn.scrollIntoViewIfNeeded();
            await retryBtn.click();
            console.log("[RACV] Re-submitted form, waiting again...");
            continue;
          }
        }
      }
    }
    await page.waitForTimeout(3000);

    await page.screenshot({ path: "/tmp/racv-quote-result.png", fullPage: true });

    // ── STEP 4: Extract quote ──
    console.log("[RACV] Extracting premium...");

    const resultText = await page.textContent("body") || "";

    const pageHeadings = await page.locator("h1:visible, h2:visible, h3:visible").allTextContents();
    console.log("[RACV] Page headings:", pageHeadings.filter(h => h.trim()).map(h => h.trim()).join(" | "));

    const allAmounts = resultText.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
    console.log(`[RACV] Dollar amounts found: ${allAmounts.join(", ")}`);

    let annualPremium: number | undefined;
    let monthlyPremium: number | undefined;
    let excessAmount: number | undefined;

    // Pattern matching for labeled premiums
    const premPatterns = [
      { pattern: /\$([\d,]+(?:\.\d{2})?)\s*(?:per\s*year|\/\s*year|annually|p\.a\.|\/yr|\/Yearly)/i, type: "annual" },
      { pattern: /(?:annual|yearly)\s*(?:premium|price|cost)[:\s]*\$([\d,]+(?:\.\d{2})?)/i, type: "annual" },
      { pattern: /\$([\d,]+(?:\.\d{2})?)\s*(?:per\s*month|\/\s*month|\/Monthly|monthly|p\.m\.|\/mo)/i, type: "monthly" },
      { pattern: /(?:monthly)\s*(?:premium|price|cost)[:\s]*\$([\d,]+(?:\.\d{2})?)/i, type: "monthly" },
    ];

    for (const { pattern, type } of premPatterns) {
      const m = resultText.match(pattern);
      if (m) {
        const amount = parseFloat(m[1].replace(/,/g, ""));
        if (type === "monthly") {
          monthlyPremium = amount;
        } else {
          annualPremium = amount;
        }
      }
    }

    // Fallback: look for amounts in reasonable ranges
    if (!annualPremium && !monthlyPremium) {
      const numericAmounts = allAmounts
        .map(a => parseFloat(a.replace(/[$,]/g, "")))
        .filter(n => !isNaN(n));

      const annualCandidates = numericAmounts.filter(n => n >= 300 && n <= 8000);
      const monthlyCandidates = numericAmounts.filter(n => n >= 25 && n < 300);

      if (annualCandidates.length > 0) annualPremium = annualCandidates[0];
      if (monthlyCandidates.length > 0) monthlyPremium = monthlyCandidates[0];

      const excessCandidates = numericAmounts.filter(n => [650, 800, 1000, 1500].includes(n));
      if (excessCandidates.length > 0) excessAmount = excessCandidates[0];
    }

    if (annualPremium || monthlyPremium) {
      console.log(`[RACV] Quote: annual=$${annualPremium}, monthly=$${monthlyPremium}`);
      return {
        success: true,
        vehicle_description: vehicleDesc,
        annual_premium: annualPremium,
        monthly_premium: monthlyPremium,
        excess_amount: excessAmount,
        raw_amounts: allAmounts,
        screenshot_path: "/tmp/racv-quote-result.png",
      };
    }

    // Check for validation errors
    const currentErrors = await page.locator("[class*='error']:visible, [class*='Error']:visible").allTextContents();
    if (currentErrors.length > 0) {
      return {
        success: false,
        vehicle_description: vehicleDesc,
        error: `Form validation errors: ${currentErrors.filter(e => e.trim()).join(", ")}`,
        step_reached: "about_you",
        raw_amounts: allAmounts,
        screenshot_path: "/tmp/racv-quote-result.png",
      };
    }

    return {
      success: false,
      vehicle_description: vehicleDesc,
      error: "Reached the end of the form but could not extract a premium. The page may require additional steps.",
      step_reached: "quote_result",
      raw_amounts: allAmounts,
      screenshot_path: "/tmp/racv-quote-result.png",
    };

  } catch (error) {
    console.error("[RACV] Error:", error);
    if (page) {
      await page.screenshot({ path: "/tmp/racv-error.png", fullPage: true }).catch(() => {});
    }
    return {
      success: false,
      error: `Scraper error: ${error instanceof Error ? error.message : String(error)}`,
      screenshot_path: "/tmp/racv-error.png",
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }
}
