import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const coverageData: Record<string, { title: string; details: string[] }> = {
  standard_inclusions: {
    title: "Standard Coverage Inclusions",
    details: [
      "Accident damage — cover for damage to your car caused by a collision or accident, whether you're at fault or not",
      "Fire and theft — protection if your car is stolen or damaged by fire",
      "Storm, flood and hail damage — cover for weather-related damage including storms, floods and hail",
      "Windscreen and window glass — repair or replacement of damaged windscreens and windows with no excess for repairs",
      "Malicious damage and vandalism — cover if your car is intentionally damaged by someone else",
      "Personal items — up to $1,000 cover for personal belongings stolen from or damaged in your car",
      "Emergency accommodation and transport — up to $1,500 for accommodation and transport if your car is undriveable more than 100km from home",
      "New car replacement — if your car is less than 2 years old and is written off or stolen, we'll replace it with a new one of the same make and model",
      "Lifetime repair guarantee — repairs carried out by RACV approved repairers are guaranteed for the life of your ownership",
      "Towing — reasonable costs to tow your car to the nearest repairer or safe location after an insured incident",
      "Third party property damage — cover for damage you cause to other people's property with your car, up to $20 million",
      "24/7 claims support — lodge and manage your claim anytime via phone or online",
    ],
  },
  optional_extras: {
    title: "Optional Extras (available at additional cost)",
    details: [
      "Hire car after an incident — a hire car for up to 30 days while your car is being repaired or if it's stolen",
      "Hire car after not-at-fault incident — a hire car when the incident wasn't your fault, no additional cost",
      "Roadside assistance — RACV's roadside assistance bundle included with your policy",
      "Agreed value — lock in the payout amount for your car at the start of the policy, rather than market value at claim time",
      "Reduced excess for named drivers — lower your excess by nominating experienced drivers",
      "Trailer and caravan cover — extend your cover to include damage to a trailer or caravan while attached to your car",
      "Tools of trade — increased cover (up to $5,000) for tools and equipment carried in your vehicle for work",
    ],
  },
  exclusions: {
    title: "Key Exclusions",
    details: [
      "Mechanical or electrical failure or breakdown (not caused by an insured incident)",
      "Wear and tear, rust, corrosion, or gradual deterioration",
      "Damage from using the car for ride-share, hire, or racing/speed testing",
      "Intentional damage caused by you or someone acting with your consent",
      "Driving under the influence of alcohol or drugs",
      "Driving without a valid licence for the class of vehicle",
      "Pre-existing damage not disclosed at the time of purchase",
      "Damage caused while the car is being used for an unlawful purpose",
      "Tyre damage from road punctures, cuts, or bursts (unless part of a larger insured incident)",
      "Diminution in value — any reduction in your car's market value after repair",
      "Refer to the full PDS at racv.com.au/pds for all exclusions and conditions",
    ],
  },
  excess_options: {
    title: "Excess Options",
    details: [
      "Standard excess ($650) — the default excess amount applicable to most claims",
      "Voluntary excess ($800) — choose a slightly higher excess to reduce your premium by approximately 3%",
      "Higher voluntary excess ($1,000) — reduce your premium by approximately 7% with a $1,000 excess",
      "Maximum voluntary excess ($1,500) — the highest savings on your premium, approximately 12% reduction",
      "Age excess — an additional excess of $400-$900 applies for drivers under 25 years of age",
      "Inexperienced driver excess — an additional $400 excess applies if the driver has held their licence for less than 2 years",
      "Note: excesses are cumulative — e.g. a young inexperienced driver may pay standard + age + inexperienced driver excess",
    ],
  },
  claims_process: {
    title: "How to Make a Claim",
    details: [
      "1. Report the incident — call RACV on 13 19 03 (24/7) or lodge online at racv.com.au/claims",
      "2. Provide details — you'll need your policy number, details of the incident, photos if possible, and a police report number (if applicable)",
      "3. Assessment — RACV will assess your claim and may arrange an assessor to inspect the damage",
      "4. Repair — choose an RACV approved repairer for lifetime repair guarantee, or nominate your own repairer",
      "5. Excess payment — pay your applicable excess directly to the repairer when collecting your vehicle",
      "6. Settlement — if your car is a total loss, RACV will pay the agreed or market value minus your excess",
      "Average claim processing time: 1-3 business days for straightforward claims",
      "Urgent assistance: RACV can arrange towing and emergency support immediately after an incident",
    ],
  },
};

export function registerGetCoverage(server: McpServer) {
  server.tool(
    "get_coverage_details",
    "Get detailed coverage information for RACV comprehensive motor insurance, including what's covered, optional extras, exclusions, excess options, and how to make a claim.",
    {
      coverage_area: z
        .enum([
          "standard_inclusions",
          "optional_extras",
          "exclusions",
          "excess_options",
          "claims_process",
        ])
        .describe(
          "The coverage area to get details about: standard_inclusions, optional_extras, exclusions, excess_options, or claims_process"
        ),
    },
    async (params) => {
      const info = coverageData[params.coverage_area];

      if (!info) {
        return {
          content: [
            {
              type: "text",
              text: "Coverage area not found. Available areas: standard_inclusions, optional_extras, exclusions, excess_options, claims_process",
            },
          ],
        };
      }

      const text = [
        `RACV Comprehensive Motor Insurance — ${info.title}`,
        "",
        ...info.details.map((d) => `• ${d}`),
        "",
        "For full details, refer to the Product Disclosure Statement (PDS) at racv.com.au/pds",
        "This information is general in nature and does not constitute personal financial advice.",
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          type: "coverage_details",
          data: {
            area: params.coverage_area,
            title: info.title,
            details: info.details,
          },
        } as any,
      };
    }
  );
}
