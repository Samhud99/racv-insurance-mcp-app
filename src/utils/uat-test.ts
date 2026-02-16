/**
 * End-to-end UAT test suite for RACV Insurance MCP App.
 * Opens Chrome (headed) and tests all functionality visually.
 */
import { chromium, Browser, Page } from "playwright";

const BASE = "http://localhost:3000";
const MCP = `${BASE}/mcp`;

let browser: Browser;
let sessionId: string;
const results: { test: string; status: "PASS" | "FAIL"; detail?: string }[] = [];

function log(test: string, status: "PASS" | "FAIL", detail?: string) {
  results.push({ test, status, detail });
  const icon = status === "PASS" ? "\u2705" : "\u274C";
  console.log(`${icon} ${test}${detail ? ` — ${detail}` : ""}`);
}

async function mcpRequest(method: string, params: any, id: number): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(MCP, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  // Extract session ID from response headers
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  const text = await res.text();
  // Parse SSE response
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.slice(6));
    }
  }
  // Try plain JSON
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function testHealthCheck() {
  try {
    const res = await fetch(BASE);
    const data = await res.json();
    if (data.status === "healthy" && data.name === "racv-insurance-app") {
      log("Health Check", "PASS", `${data.name} v${data.version}`);
    } else {
      log("Health Check", "FAIL", JSON.stringify(data));
    }
  } catch (e: any) {
    log("Health Check", "FAIL", e.message);
  }
}

async function testMcpInitialize() {
  try {
    const data = await mcpRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "uat-tester", version: "1.0.0" },
    }, 1);

    if (data.result?.serverInfo?.name === "racv-insurance-app" && sessionId) {
      log("MCP Initialize", "PASS", `Session: ${sessionId.slice(0, 8)}...`);
    } else {
      log("MCP Initialize", "FAIL", JSON.stringify(data));
    }
  } catch (e: any) {
    log("MCP Initialize", "FAIL", e.message);
  }
}

async function testToolsList() {
  try {
    // Send initialized notification first
    await fetch(MCP, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    const data = await mcpRequest("tools/list", {}, 2);
    const tools = data.result?.tools || [];
    const names = tools.map((t: any) => t.name);

    if (
      names.includes("get_motor_quote") &&
      names.includes("get_coverage_details") &&
      names.includes("start_full_quote")
    ) {
      log("Tools List", "PASS", `${tools.length} tools: ${names.join(", ")}`);
    } else {
      log("Tools List", "FAIL", `Found: ${names.join(", ")}`);
    }
  } catch (e: any) {
    log("Tools List", "FAIL", e.message);
  }
}

async function testGetMotorQuote() {
  const testCases = [
    {
      name: "Economy car (Toyota Corolla, young driver, CBD)",
      args: { vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_year: 2022, postcode: "3000", driver_age: 22, claims_last_5_years: 0, parking_type: "street" },
      expect: { minPremium: 1000, maxPremium: 4000 },
    },
    {
      name: "Luxury car (BMW X5, middle age, suburban)",
      args: { vehicle_make: "BMW", vehicle_model: "X5", vehicle_year: 2024, postcode: "3128", driver_age: 45, claims_last_5_years: 0, parking_type: "garage" },
      expect: { minPremium: 1500, maxPremium: 4000 },
    },
    {
      name: "Performance car (Subaru WRX, claims history, inner city)",
      args: { vehicle_make: "Subaru", vehicle_model: "WRX", vehicle_year: 2020, postcode: "3065", driver_age: 28, claims_last_5_years: 2, parking_type: "street" },
      expect: { minPremium: 2000, maxPremium: 6000 },
    },
    {
      name: "Regional Victoria (Mazda CX-5, older driver, garage)",
      args: { vehicle_make: "Mazda", vehicle_model: "CX-5", vehicle_year: 2021, postcode: "3350", driver_age: 55, claims_last_5_years: 0, parking_type: "garage" },
      expect: { minPremium: 800, maxPremium: 2000 },
    },
    {
      name: "Unknown vehicle (should use default midrange)",
      args: { vehicle_make: "Rivian", vehicle_model: "R1S", vehicle_year: 2025, postcode: "3121", driver_age: 35, claims_last_5_years: 0, parking_type: "driveway" },
      expect: { minPremium: 800, maxPremium: 2500 },
    },
  ];

  let id = 10;
  for (const tc of testCases) {
    try {
      const data = await mcpRequest("tools/call", { name: "get_motor_quote", arguments: tc.args }, id++);
      const sc = data.result?.structuredContent?.data;
      const text = data.result?.content?.[0]?.text;

      if (!sc) {
        log(`Quote: ${tc.name}`, "FAIL", "No structuredContent");
        continue;
      }

      const annual = sc.premium_range_annual;
      const checks = [
        annual.min >= tc.expect.minPremium,
        annual.max <= tc.expect.maxPremium,
        annual.min < annual.max,
        sc.quote_id?.startsWith("RACV-"),
        sc.excess_options?.length === 4,
        sc.coverage_summary?.length >= 5,
        sc.member_discount_available === true,
        sc.disclaimers?.length >= 4,
        sc.valid_until?.length === 10,
        text?.includes("RACV Comprehensive Motor Insurance"),
      ];

      if (checks.every(Boolean)) {
        log(`Quote: ${tc.name}`, "PASS", `$${annual.min}-$${annual.max}/yr, zone=${sc.risk_zone}`);
      } else {
        const failIdx = checks.findIndex((c) => !c);
        log(`Quote: ${tc.name}`, "FAIL", `Check #${failIdx} failed. Annual: $${annual.min}-$${annual.max}`);
      }
    } catch (e: any) {
      log(`Quote: ${tc.name}`, "FAIL", e.message);
    }
  }
}

async function testGetCoverageDetails() {
  const areas = ["standard_inclusions", "optional_extras", "exclusions", "excess_options", "claims_process"];
  let id = 30;

  for (const area of areas) {
    try {
      const data = await mcpRequest("tools/call", { name: "get_coverage_details", arguments: { coverage_area: area } }, id++);
      const text = data.result?.content?.[0]?.text;
      const sc = data.result?.structuredContent?.data;

      if (text && text.length > 100 && sc?.details?.length > 0) {
        log(`Coverage: ${area}`, "PASS", `${sc.details.length} items`);
      } else {
        log(`Coverage: ${area}`, "FAIL", `text=${text?.length}, items=${sc?.details?.length}`);
      }
    } catch (e: any) {
      log(`Coverage: ${area}`, "FAIL", e.message);
    }
  }
}

async function testStartFullQuote() {
  try {
    const data = await mcpRequest("tools/call", { name: "start_full_quote", arguments: { quote_id: "RACV-TEST1234" } }, 40);
    const text = data.result?.content?.[0]?.text;
    const sc = data.result?.structuredContent?.data;

    const checks = [
      text?.includes("racv.com.au"),
      text?.includes("RACV-TEST1234"),
      sc?.redirect_url?.includes("utm_source=ai_platform"),
      sc?.redirect_url?.includes("ref=RACV-TEST1234"),
      sc?.session_validity,
    ];

    if (checks.every(Boolean)) {
      log("Start Full Quote", "PASS", `URL: ${sc.redirect_url.slice(0, 60)}...`);
    } else {
      log("Start Full Quote", "FAIL", `Checks: ${checks.map((c, i) => `#${i}=${c}`).join(", ")}`);
    }
  } catch (e: any) {
    log("Start Full Quote", "FAIL", e.message);
  }
}

async function testWidgetsInChrome() {
  console.log("\n--- Opening Chrome for visual widget testing ---\n");

  browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1400,900"],
  });

  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });

  // Test 1: Quote Result Widget
  console.log("Opening quote result widget...");
  const quotePage = await context.newPage();
  await quotePage.goto(`${BASE}/widget/quote-result.html`, { waitUntil: "domcontentloaded" });
  await quotePage.waitForTimeout(2000);

  // Verify widget rendered with demo data
  const quoteTitle = await quotePage.textContent(".header-text h1");
  const vehicleName = await quotePage.textContent("#vehicleName");
  const premiumDisplay = await quotePage.textContent("#premiumDisplay");
  const excessCards = await quotePage.locator(".excess-card").count();
  const coverageItems = await quotePage.locator(".coverage-list li").count();
  const ctaHref = await quotePage.getAttribute("#ctaButton", "href");

  if (quoteTitle?.includes("Comprehensive") && vehicleName && premiumDisplay !== "$—" && excessCards === 4 && coverageItems >= 5 && ctaHref?.includes("racv.com.au")) {
    log("Widget: Quote renders with demo data", "PASS", `Vehicle: ${vehicleName}, Premium: ${premiumDisplay}, ${excessCards} excess cards, ${coverageItems} coverage items`);
  } else {
    log("Widget: Quote renders with demo data", "FAIL", `title=${quoteTitle}, vehicle=${vehicleName}, premium=${premiumDisplay}, excess=${excessCards}, coverage=${coverageItems}`);
  }

  // Test annual/monthly toggle
  await quotePage.click("#btnMonthly");
  await quotePage.waitForTimeout(500);
  const monthlyPer = await quotePage.textContent("#premiumPer");
  if (monthlyPer === "/month") {
    log("Widget: Monthly toggle", "PASS");
  } else {
    log("Widget: Monthly toggle", "FAIL", `per=${monthlyPer}`);
  }

  await quotePage.click("#btnAnnual");
  await quotePage.waitForTimeout(500);
  const annualPer = await quotePage.textContent("#premiumPer");
  if (annualPer === "/year") {
    log("Widget: Annual toggle", "PASS");
  } else {
    log("Widget: Annual toggle", "FAIL", `per=${annualPer}`);
  }

  // Test excess card selection
  const secondExcess = quotePage.locator(".excess-card").nth(1);
  await secondExcess.click();
  await quotePage.waitForTimeout(500);
  const isSelected = await secondExcess.evaluate((el) => el.classList.contains("selected"));
  if (isSelected) {
    log("Widget: Excess card selection", "PASS");
  } else {
    log("Widget: Excess card selection", "FAIL");
  }

  // Test with real quote data via postMessage
  const realQuote = await mcpRequest("tools/call", {
    name: "get_motor_quote",
    arguments: {
      vehicle_make: "Tesla",
      vehicle_model: "Model 3",
      vehicle_year: 2024,
      postcode: "3121",
      driver_age: 32,
      claims_last_5_years: 0,
      parking_type: "garage",
    },
  }, 50);

  const quoteData = realQuote.result?.structuredContent?.data;
  if (quoteData) {
    await quotePage.evaluate((data) => {
      window.postMessage(JSON.stringify({ type: "quote_result", data }), "*");
    }, quoteData);
    await quotePage.waitForTimeout(1500);

    const updatedVehicle = await quotePage.textContent("#vehicleName");
    const updatedPremium = await quotePage.textContent("#premiumDisplay");
    if (updatedVehicle?.includes("Tesla") && updatedPremium !== "$—") {
      log("Widget: PostMessage data injection", "PASS", `Vehicle: ${updatedVehicle}, Premium: ${updatedPremium}`);
    } else {
      log("Widget: PostMessage data injection", "FAIL", `vehicle=${updatedVehicle}, premium=${updatedPremium}`);
    }
  }

  // Screenshot the quote widget
  await quotePage.screenshot({ path: "/tmp/uat-quote-widget.png", fullPage: true });
  console.log("  Screenshot: /tmp/uat-quote-widget.png");

  // Test 2: Coverage Info Widget
  console.log("\nOpening coverage info widget...");
  const coveragePage = await context.newPage();
  await coveragePage.goto(`${BASE}/widget/coverage-info.html`, { waitUntil: "domcontentloaded" });
  await coveragePage.waitForTimeout(2000);

  const coverageTitle = await coveragePage.textContent("#areaTitle");
  const coverageDetailCount = await coveragePage.locator(".detail-list li").count();
  const tabCount = await coveragePage.locator(".tab").count();

  if (coverageTitle && coverageDetailCount > 0 && tabCount === 5) {
    log("Widget: Coverage renders", "PASS", `Title: ${coverageTitle}, ${coverageDetailCount} items, ${tabCount} tabs`);
  } else {
    log("Widget: Coverage renders", "FAIL", `title=${coverageTitle}, items=${coverageDetailCount}, tabs=${tabCount}`);
  }

  // Test tab switching
  const tabs = ["optional_extras", "exclusions", "excess_options", "claims_process"];
  for (const tab of tabs) {
    await coveragePage.click(`[data-area="${tab}"]`);
    await coveragePage.waitForTimeout(500);
    const title = await coveragePage.textContent("#areaTitle");
    const items = await coveragePage.locator(".detail-list li").count();
    if (title && items > 0) {
      log(`Widget: Tab ${tab}`, "PASS", `${items} items`);
    } else {
      log(`Widget: Tab ${tab}`, "FAIL", `title=${title}, items=${items}`);
    }
  }

  // Screenshot the coverage widget
  await coveragePage.screenshot({ path: "/tmp/uat-coverage-widget.png", fullPage: true });
  console.log("  Screenshot: /tmp/uat-coverage-widget.png");

  // Test 3: Mobile responsiveness
  console.log("\nTesting mobile responsive layout...");
  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 375, height: 812 }); // iPhone size
  await mobilePage.goto(`${BASE}/widget/quote-result.html`, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForTimeout(2000);

  const mobileVehicle = await mobilePage.textContent("#vehicleName");
  const mobilePremium = await mobilePage.textContent("#premiumDisplay");
  if (mobileVehicle && mobilePremium !== "$—") {
    log("Widget: Mobile responsive", "PASS", `Renders at 375px width`);
  } else {
    log("Widget: Mobile responsive", "FAIL");
  }

  await mobilePage.screenshot({ path: "/tmp/uat-mobile-widget.png", fullPage: true });
  console.log("  Screenshot: /tmp/uat-mobile-widget.png");

  // Keep browser open for 10 seconds for visual inspection
  console.log("\nBrowser open for visual inspection (10s)...");
  await quotePage.bringToFront();
  await new Promise((resolve) => setTimeout(resolve, 10000));

  await browser.close();
}

async function testInputValidation() {
  // Test invalid postcode (non-VIC)
  try {
    const data = await mcpRequest("tools/call", {
      name: "get_motor_quote",
      arguments: {
        vehicle_make: "Toyota",
        vehicle_model: "Corolla",
        vehicle_year: 2022,
        postcode: "2000", // Sydney postcode — should fail
        driver_age: 30,
        claims_last_5_years: 0,
        parking_type: "garage",
      },
    }, 60);

    if (data.result?.isError || data.error) {
      log("Validation: Non-VIC postcode rejected", "PASS");
    } else {
      log("Validation: Non-VIC postcode rejected", "FAIL", "Should have rejected postcode 2000");
    }
  } catch (e: any) {
    log("Validation: Non-VIC postcode rejected", "PASS", "Error thrown as expected");
  }

  // Test invalid age
  try {
    const data = await mcpRequest("tools/call", {
      name: "get_motor_quote",
      arguments: {
        vehicle_make: "Toyota",
        vehicle_model: "Corolla",
        vehicle_year: 2022,
        postcode: "3000",
        driver_age: 10, // Too young
        claims_last_5_years: 0,
        parking_type: "garage",
      },
    }, 61);

    if (data.result?.isError || data.error) {
      log("Validation: Under-age driver rejected", "PASS");
    } else {
      log("Validation: Under-age driver rejected", "FAIL", "Should have rejected age 10");
    }
  } catch (e: any) {
    log("Validation: Under-age driver rejected", "PASS");
  }
}

async function testSessionTermination() {
  try {
    const res = await fetch(MCP, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": sessionId },
    });
    if (res.ok) {
      log("Session Termination", "PASS");
    } else {
      log("Session Termination", "FAIL", `Status: ${res.status}`);
    }
  } catch (e: any) {
    log("Session Termination", "FAIL", e.message);
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   RACV Insurance MCP App — UAT Test Suite       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("--- API & MCP Protocol Tests ---\n");
  await testHealthCheck();
  await testMcpInitialize();
  await testToolsList();

  console.log("\n--- Quote Tool Tests (5 scenarios) ---\n");
  await testGetMotorQuote();

  console.log("\n--- Coverage Tool Tests ---\n");
  await testGetCoverageDetails();

  console.log("\n--- Handoff Tool Test ---\n");
  await testStartFullQuote();

  console.log("\n--- Input Validation Tests ---\n");
  await testInputValidation();

  console.log("\n--- Chrome Widget Visual Tests ---\n");
  await testWidgetsInChrome();

  console.log("\n--- Session Tests ---\n");
  await testSessionTermination();

  // Summary
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log(`║   Results: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  if (failed > 0) {
    console.log("Failed tests:");
    results.filter((r) => r.status === "FAIL").forEach((r) => {
      console.log(`  \u274C ${r.test}: ${r.detail || ""}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("UAT runner error:", e);
  process.exit(1);
});
