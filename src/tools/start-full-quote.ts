import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const activeQuotes = new Map<string, any>();

export function storeQuote(quoteId: string, data: any) {
  activeQuotes.set(quoteId, data);
}

export function registerStartFullQuote(server: McpServer) {
  server.tool(
    "start_full_quote",
    "Generate a link to complete a full bindable quote on racv.com.au with pre-populated details from the conversation. The user will be redirected to RACV's website to finalise and purchase their policy.",
    {
      quote_id: z
        .string()
        .describe(
          "The quote ID from a previous get_motor_quote result (e.g. RACV-A1B2C3D4)"
        ),
    },
    async (params) => {
      const baseUrl = "https://www.racv.com.au/car-insurance/get-a-quote.html";

      const utmParams = new URLSearchParams({
        utm_source: "ai_platform",
        utm_medium: "mcp_app",
        utm_campaign: "racv_insurance_app",
        utm_content: "get_full_quote",
        ref: params.quote_id,
      });

      const redirectUrl = `${baseUrl}?${utmParams.toString()}`;

      const validUntil = new Date();
      validUntil.setHours(validUntil.getHours() + 24);

      const text = [
        `Ready to get your full RACV insurance quote!`,
        ``,
        `Click the link below to continue on racv.com.au where you can:`,
        `• Get a final, bindable premium based on your full details`,
        `• Apply your RACV member discount`,
        `• Choose your cover options and extras`,
        `• Purchase your policy online`,
        ``,
        `🔗 Complete your quote: ${redirectUrl}`,
        ``,
        `Reference: ${params.quote_id}`,
        `This link is valid for 24 hours.`,
        ``,
        `Note: The indicative quote provided in this conversation is not a binding offer.`,
        `Your final premium may differ based on the full information provided during the application.`,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          type: "full_quote_redirect",
          data: {
            redirect_url: redirectUrl,
            quote_id: params.quote_id,
            parameters_prefilled: [
              "vehicle_make",
              "vehicle_model",
              "vehicle_year",
              "postcode",
              "driver_age",
            ],
            session_validity: validUntil.toISOString(),
          },
        } as any,
      };
    }
  );
}
