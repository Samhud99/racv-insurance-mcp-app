import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve data paths — works whether run from dist/ or src/ (via tsx)
function resolveDataPath(filename: string): string {
  const fromDist = join(__dirname, "../data", filename);
  const fromSrc = join(__dirname, "../../src/data", filename);
  try {
    readFileSync(fromDist);
    return fromDist;
  } catch {
    return fromSrc;
  }
}

const vehicles = JSON.parse(readFileSync(resolveDataPath("vehicles.json"), "utf-8"));
const postcodes = JSON.parse(readFileSync(resolveDataPath("postcodes.json"), "utf-8"));
const pricingRules = JSON.parse(readFileSync(resolveDataPath("pricing-rules.json"), "utf-8"));

export interface QuoteInput {
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  postcode: string;
  driver_age: number;
  claims_last_5_years: number;
  parking_type: "garage" | "carport" | "street" | "driveway";
}

export interface ExcessOption {
  amount: number;
  label: string;
  annual_premium: number;
  monthly_premium: number;
}

export interface QuoteResult {
  quote_id: string;
  premium_range_annual: { min: number; max: number };
  premium_range_monthly: { min: number; max: number };
  excess_options: ExcessOption[];
  coverage_summary: string[];
  member_discount_available: boolean;
  member_discount_pct: number;
  valid_until: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
    category: string;
    estimated_value: number;
  };
  risk_zone: string;
  disclaimers: string[];
}

function getVehicleInfo(make: string, model: string): { category: string; base_value: number } | null {
  const makeNorm = Object.keys(vehicles).find(
    (m) => m.toLowerCase() === make.toLowerCase()
  );
  if (!makeNorm) return null;

  const modelNorm = Object.keys(vehicles[makeNorm]).find(
    (mod) => mod.toLowerCase().replace(/[-\s]/g, "") === model.toLowerCase().replace(/[-\s]/g, "")
  );
  if (!modelNorm) return null;

  return vehicles[makeNorm][modelNorm];
}

function getPostcodeRiskZone(postcode: string): string {
  const pc = parseInt(postcode, 10);
  const zones = postcodes.risk_zones;

  for (const [zone, config] of Object.entries(zones) as [string, any][]) {
    if (config.postcodes?.includes(postcode)) return zone;
    for (const [min, max] of config.ranges || []) {
      if (pc >= min && pc <= max) return zone;
    }
  }

  return "medium";
}

function getAgeMultiplier(age: number): number {
  for (const bracket of pricingRules.age_multipliers) {
    if (age >= bracket.min_age && age <= bracket.max_age) {
      return bracket.multiplier;
    }
  }
  return 1.0;
}

function getVehicleAgeMultiplier(vehicleYear: number): number {
  const currentYear = new Date().getFullYear();
  const age = currentYear - vehicleYear;
  for (const bracket of pricingRules.vehicle_age_adjustments) {
    if (age >= bracket.min_years && age <= bracket.max_years) {
      return bracket.multiplier;
    }
  }
  return 1.0;
}

function depreciate(baseValue: number, vehicleYear: number): number {
  const currentYear = new Date().getFullYear();
  const age = currentYear - vehicleYear;
  if (age <= 0) return baseValue;
  const rate = 0.12;
  return Math.round(baseValue * Math.pow(1 - rate, age));
}

export function calculateQuote(input: QuoteInput): QuoteResult {
  const vehicleInfo = getVehicleInfo(input.vehicle_make, input.vehicle_model);
  const category = vehicleInfo?.category ?? "midrange";
  const baseValue = vehicleInfo?.base_value ?? 35000;
  const estimatedValue = depreciate(baseValue, input.vehicle_year);

  const baseRate = pricingRules.base_rates[category] as { min: number; max: number };
  const basePremium = (baseRate.min + baseRate.max) / 2;

  const ageMultiplier = getAgeMultiplier(input.driver_age);
  const claimsMultiplier =
    pricingRules.claims_multipliers[String(input.claims_last_5_years)] ?? 1.0;
  const riskZone = getPostcodeRiskZone(input.postcode);
  const postcodeMultiplier =
    pricingRules.postcode_risk_multipliers[riskZone] ?? 1.0;
  const parkingMultiplier =
    pricingRules.parking_multipliers[input.parking_type] ?? 1.0;
  const vehicleAgeMultiplier = getVehicleAgeMultiplier(input.vehicle_year);

  const annualPremium = Math.round(
    basePremium *
      ageMultiplier *
      claimsMultiplier *
      postcodeMultiplier *
      parkingMultiplier *
      vehicleAgeMultiplier
  );

  const spread = pricingRules.range_spread_pct / 100;
  const annualMin = Math.round(annualPremium * (1 - spread));
  const annualMax = Math.round(annualPremium * (1 + spread));
  const monthlyMin = Math.round((annualMin / 12) * 1.05);
  const monthlyMax = Math.round((annualMax / 12) * 1.05);

  const excessOptions: ExcessOption[] = pricingRules.excess_options.map(
    (opt: { amount: number; label: string; discount_pct: number }) => {
      const discountedAnnual = Math.round(
        annualPremium * (1 - opt.discount_pct / 100)
      );
      return {
        amount: opt.amount,
        label: opt.label,
        annual_premium: discountedAnnual,
        monthly_premium: Math.round((discountedAnnual / 12) * 1.05),
      };
    }
  );

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  return {
    quote_id: `RACV-${randomUUID().slice(0, 8).toUpperCase()}`,
    premium_range_annual: { min: annualMin, max: annualMax },
    premium_range_monthly: { min: monthlyMin, max: monthlyMax },
    excess_options: excessOptions,
    coverage_summary: pricingRules.coverage_highlights,
    member_discount_available: true,
    member_discount_pct: pricingRules.member_discount_pct,
    valid_until: validUntil.toISOString().split("T")[0],
    vehicle: {
      make: input.vehicle_make,
      model: input.vehicle_model,
      year: input.vehicle_year,
      category,
      estimated_value: estimatedValue,
    },
    risk_zone: riskZone,
    disclaimers: [
      "This is an indicative quote only and is not a binding offer of insurance.",
      "Final premium will be determined upon completion of a full application on racv.com.au.",
      "RACV Comprehensive Car Insurance is issued by Insurance Manufacturers of Australia Pty Ltd (IMA) ABN 93 004 208 084, AFS Licence No. 227678.",
      "Please refer to the Product Disclosure Statement (PDS) for full terms, conditions and exclusions at racv.com.au/pds.",
      "This information is general in nature and does not constitute personal financial advice."
    ],
  };
}
