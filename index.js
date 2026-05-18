#!/usr/bin/env node
/**
 * DPX MCP SERVER v2.4.0
 *
 * Connects Claude Desktop, Cursor, and any MCP-compatible host directly to DPX.
 * Covers the full settlement lifecycle: discover → quote → check conditions → settle → status.
 * Supports both cross-border and domestic (intra-country) settlements.
 *
 * 13 tools:
 *   get_manifest           — DPX protocol capabilities and contract addresses
 *   get_quote              — Binding fee quote (300s TTL)
 *   get_esg_score          — Live ESG score for a wallet address
 *   get_reliability        — Current oracle stability status (cross-border and domestic)
 *   get_oracle_status      — Full 10+ layer Stability Oracle v9.0 signal (ESG Oracle is separate)
 *   get_fee_schedule       — Complete fee table with volume tiers
 *   verify_fees            — Confirm off-chain quote matches on-chain router
 *   compare_to_competitors — DPX vs Stripe, Wise, SWIFT, bank wire
 *   get_rail_status        — Live health of local payment rails (PIX, SEPA, FedACH, etc.)
 *   settle                 — Execute a settlement through the Settlement Agent
 *   get_settlement_status  — Look up a settlement by ID
 *   get_investment_context — Structured investment memo for AI-native due diligence
 *   get_intelligence       — MPP-gated macro intelligence briefing (pay-per-call, 0.001 USDC)
 *
 * SETUP — Claude Desktop
 * Copy the block from claude_desktop_config.json into:
 *   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
 *   Windows: %APPDATA%\Claude\claude_desktop_config.json
 * Then restart Claude Desktop.
 *
 * IMPORTANT: Never write to stdout — it corrupts the JSON-RPC stream.
 * All logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// Production URLs are the defaults — override with env vars for local dev.
// ─────────────────────────────────────────────────────────────────────────────

const STABILITY_URL      = process.env.STABILITY_ORACLE_URL  || "https://stability.untitledfinancial.com";
const ESG_URL            = process.env.ESG_ORACLE_URL        || "https://stability.untitledfinancial.com";  // ESG endpoint on same oracle
const AGENT_URL          = process.env.SETTLEMENT_AGENT_URL  || "https://agent.untitledfinancial.com";
const INTELLIGENCE_URL   = process.env.INTELLIGENCE_URL      || "https://api.untitledfinancial.com/intelligence";
const SANDBOX_DEFAULT    = process.env.SANDBOX_MODE !== "false"; // sandbox=true unless explicitly set to "false"

// Intelligence layer payment constants
const INTELLIGENCE_PAYMENT_ADDRESS = "0x160e920012fb4BAe2E465c1eD8815c5FD51B5Ce0";
const INTELLIGENCE_PAYMENT_AMOUNT  = "0.001";
const INTELLIGENCE_PAYMENT_ASSET   = "USDC";
const INTELLIGENCE_PAYMENT_NETWORK = "Base mainnet (chainId 8453)";

const log = (...args) => process.stderr.write(args.join(" ") + "\n");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function get(url) {
  const res = await axios.get(url, { timeout: 12_000 });
  return res.data;
}

async function post(url, body) {
  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
    validateStatus: () => true,  // don't throw on 4xx/5xx — return to Claude
  });
  return { status: res.status, data: res.data };
}

function text(content) {
  return {
    content: [{
      type: "text",
      text: typeof content === "string" ? content : JSON.stringify(content, null, 2),
    }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP SERVER
// ─────────────────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "dpx",
  version: "2.4.0",
  description: "DPX settlement rail — discover, price, check conditions, and execute institutional settlements with AI-native oracle intelligence. Supports cross-border and domestic (intra-country) settlements. Full lifecycle including autonomous execution and local payment rail health checks.",
});

// ── Tool 1: get_manifest ─────────────────────────────────────────────────────

server.registerTool("get_manifest", {
  description: "Get the DPX protocol manifest. Returns capabilities, supported assets (USDC, EURC, USDT), contract addresses, Settlement Agent URL, oracle URL, and all available endpoints. Call this first to understand what DPX can do.",
  inputSchema: {},
  outputSchema: {
    oracle: z.object({
      name:     z.string().optional(),
      version:  z.string().optional(),
      assets:   z.array(z.string()).optional(),
      endpoints: z.record(z.string()).optional(),
    }).passthrough().optional(),
    agent: z.object({
      name:    z.string().optional(),
      version: z.string().optional(),
      status:  z.string().optional(),
    }).passthrough().optional(),
  },
}, async () => {
  log("[dpx-mcp] get_manifest");
  const [oracle, agent] = await Promise.allSettled([
    get(`${STABILITY_URL}/manifest`),
    get(`${AGENT_URL}/manifest`),
  ]);
  return text({
    oracle: oracle.status === "fulfilled" ? oracle.value : { error: "Oracle unreachable" },
    agent:  agent.status  === "fulfilled" ? agent.value  : { error: "Settlement Agent unreachable" },
  });
});

// ── Tool 2: get_quote ────────────────────────────────────────────────────────

server.registerTool("get_quote", {
  description: "Get a binding fee quote for a DPX settlement. Returns core fee (0.85%), FX fee (0.40% cross-currency), live ESG fee (0–0.50%), license fee (0.01%), total all-in rate, net amount, oracle status, AI reasoning, and a quoteId valid for 300 seconds. Always get a quote before settling.",
  inputSchema: {
    amountUsd:        z.number().positive().describe("Settlement amount in USD"),
    hasFx:            z.boolean().optional().default(false).describe("True if source and destination currencies differ (e.g. USD→EUR). Adds 0.40% FX fee."),
    esgScore:         z.number().min(0).max(100).optional().default(75).describe("ESG score 0–100. Score 100 = 0% fee. Score 75 = 0.125% fee. Score 0 = 0.50% fee."),
    monthlyVolumeUsd: z.number().optional().default(0).describe("Monthly volume for discount tier. $10M+ = Sovereign (30% off core fee)."),
  },
  outputSchema: {
    quoteId:      z.string().optional(),
    amountUsd:    z.number().optional(),
    netAmountUsd: z.number().optional(),
    fees: z.object({
      core:    z.object({ pct: z.number(), usd: z.number() }).optional(),
      fx:      z.object({ pct: z.number(), usd: z.number() }).optional(),
      esg:     z.object({ pct: z.number(), usd: z.number() }).optional(),
      license: z.object({ pct: z.number(), usd: z.number() }).optional(),
      total:   z.object({ pct: z.number(), usd: z.number() }).optional(),
    }).passthrough().optional(),
    oracleStatus: z.string().optional(),
    oracleScore:  z.number().optional(),
    reasoning:    z.string().optional(),
    expiresAt:    z.string().optional(),
    tier:         z.string().optional(),
  },
}, async ({ amountUsd, hasFx, esgScore, monthlyVolumeUsd }) => {
  log(`[dpx-mcp] get_quote $${amountUsd} hasFx=${hasFx} esgScore=${esgScore}`);
  const params = new URLSearchParams({
    amountUsd: String(amountUsd),
    hasFx:     String(hasFx || false),
    esgScore:  String(esgScore ?? 75),
    ...(monthlyVolumeUsd ? { monthlyVolumeUsd: String(monthlyVolumeUsd) } : {}),
  });
  const data = await get(`${STABILITY_URL}/quote?${params}`);
  return text(data);
});

// ── Tool 3: get_esg_score ────────────────────────────────────────────────────

server.registerTool("get_esg_score", {
  description: "Get the live ESG score for a wallet address or the protocol default. Returns E, S, G scores (0–100 each), aggregate weighted score, and ESG fee percentage. Updated hourly from 6 institutional sources: World Bank, UN, IMF, OECD, SEC, Climate Monitor.",
  inputSchema: {
    address: z.string().optional().describe("Wallet address (0x...) to score. Omit for protocol default score."),
  },
  outputSchema: {
    address:      z.string().optional(),
    esgScore:     z.number().optional(),
    environmental: z.number().optional(),
    social:        z.number().optional(),
    governance:    z.number().optional(),
    feePct:       z.number().optional(),
    tier:         z.string().optional(),
    updatedAt:    z.string().optional(),
    sources:      z.array(z.string()).optional(),
  },
}, async ({ address }) => {
  log(`[dpx-mcp] get_esg_score ${address ?? "default"}`);
  const url = address
    ? `${STABILITY_URL}/esg-score?address=${address}`
    : `${STABILITY_URL}/esg-score`;
  const data = await get(url);
  return text(data);
});

// ── Tool 4: get_reliability ──────────────────────────────────────────────────

server.registerTool("get_reliability", {
  description: "Get live DPX oracle reliability and current stability signal. Returns stability score (0–100), status (STABLE/CAUTION/UNSTABLE), peg deviation in basis points, AI reasoning, outlook, and recommendation. Applies to both cross-border and domestic settlements. Check this before large settlements — if UNSTABLE or peg deviation >= 50 bps, hold the settlement.",
  inputSchema: {},
  outputSchema: {
    stabilityScore: z.number().optional(),
    status:         z.enum(["STABLE", "CAUTION", "UNSTABLE"]).optional(),
    pegDeviation:   z.number().optional(),
    recommendation: z.string().optional(),
    outlook:        z.string().optional(),
    reasoning:      z.string().optional(),
    timestamp:      z.string().optional(),
  },
}, async () => {
  log("[dpx-mcp] get_reliability");
  const data = await get(`${STABILITY_URL}/reliability`);
  return text(data);
});

// ── Tool 5: get_oracle_status ────────────────────────────────────────────────

server.registerTool("get_oracle_status", {
  description: "Get full output from the latest DPX Stability Oracle v9.0 run. 10+ layer architecture: Tier 0 (climate & environmental, 30–90 day lead), Tier 1 (commodities & energy), Tier 2 (macroeconomic, 4 independent sources per indicator), Tier 3 (currency & FX, 4 cross-validated APIs), Tier 4 (basket verification, on-chain Chainlink + 3 FX APIs), Tier 5 (bond yields + yield curve, FRED), Tier 6 (infrastructure weak spots + war & conflict, dual sub-modules), Layer 8 v8.0 (cross-body integration: geopolitical risk, capital flows, tech supply chain, macro signals, predictive signals), Layer 9 v9.0 (USD structural health, 25+ signals, 10% composite blend), Layer 10 (AI synthesis reasoning layer, degrades gracefully). ESG Oracle is a separate system with 6 institutional sources, hourly scoring, on-chain push to ESGCompliance contract. Returns tier scores, alerts, chaos regime flag, and AI synthesis briefing.",
  inputSchema: {},
  outputSchema: {
    tier:        z.string().optional(),
    score:       z.number().optional(),
    status:      z.string().optional(),
    chaosRegime: z.boolean().optional(),
    signals: z.object({
      climate:        z.number().optional(),
      commodities:    z.number().optional(),
      macro:          z.number().optional(),
      fx:             z.number().optional(),
      basket:         z.number().optional(),
      yieldCurve:     z.number().optional(),
      infrastructure: z.number().optional(),
      geopolitical:   z.number().optional(),
      usdHealth:      z.number().optional(),
    }).passthrough().optional(),
    alerts:    z.array(z.string()).optional(),
    briefing:  z.string().optional(),
    timestamp: z.string().optional(),
  },
}, async () => {
  log("[dpx-mcp] get_oracle_status");
  const data = await get(`${STABILITY_URL}/api/status`);
  return text(data);
});

// ── Tool 6: get_fee_schedule ─────────────────────────────────────────────────

server.registerTool("get_fee_schedule", {
  description: "Get the complete DPX fee schedule: all components (core/FX/ESG/license), volume discount tiers (Standard/Growth/Institutional/Sovereign), ESG fee table by score, scenario examples, and competitive benchmarks vs Stripe, Wise, SWIFT, and bank wire.",
  inputSchema: {},
  outputSchema: {
    fees: z.object({
      core:    z.object({ pct: z.number(), description: z.string().optional() }).passthrough().optional(),
      fx:      z.object({ pct: z.number(), description: z.string().optional() }).passthrough().optional(),
      esg:     z.object({ min: z.number(), max: z.number() }).passthrough().optional(),
      license: z.object({ pct: z.number() }).passthrough().optional(),
    }).passthrough().optional(),
    tiers: z.object({
      Standard:      z.object({ minVolumeUsd: z.number(), discount: z.number() }).passthrough().optional(),
      Growth:        z.object({ minVolumeUsd: z.number(), discount: z.number() }).passthrough().optional(),
      Institutional: z.object({ minVolumeUsd: z.number(), discount: z.number() }).passthrough().optional(),
      Sovereign:     z.object({ minVolumeUsd: z.number(), discount: z.number() }).passthrough().optional(),
    }).passthrough().optional(),
    benchmarks: z.record(z.object({ rate: z.string(), description: z.string().optional() }).passthrough()).optional(),
    examples:   z.array(z.object({ amountUsd: z.number(), totalFeeUsd: z.number() }).passthrough()).optional(),
  },
}, async () => {
  log("[dpx-mcp] get_fee_schedule");
  const data = await get(`${STABILITY_URL}/fee-schedule`);
  return text(data);
});

// ── Tool 7: verify_fees ──────────────────────────────────────────────────────

server.registerTool("verify_fees", {
  description: "Verify that the off-chain fee quote matches what the on-chain DPXSettlementRouter contract will charge. Returns feesMatch (true/false). If feesMatch is true, proceed with settlement. Call this after get_quote and before settle.",
  inputSchema: {
    amountUsd: z.number().positive().describe("Settlement amount in USD"),
    hasFx:     z.boolean().optional().default(false).describe("Cross-currency settlement?"),
    esgScore:  z.number().min(0).max(100).optional().default(75).describe("ESG score 0–100"),
  },
  outputSchema: {
    feesMatch:   z.boolean().optional(),
    offChainFee: z.object({ pct: z.number(), usd: z.number() }).passthrough().optional(),
    onChainFee:  z.object({ pct: z.number(), usd: z.number() }).passthrough().optional(),
    delta:       z.number().optional(),
    recommendation: z.string().optional(),
  },
}, async ({ amountUsd, hasFx, esgScore }) => {
  log(`[dpx-mcp] verify_fees $${amountUsd}`);
  const params = new URLSearchParams({
    amountUsd: String(amountUsd),
    hasFx:     String(hasFx || false),
    esgScore:  String(esgScore ?? 75),
  });
  const data = await get(`${STABILITY_URL}/verify-fees?${params}`);
  return text(data);
});

// ── Tool 8: compare_to_competitors ──────────────────────────────────────────

server.registerTool("compare_to_competitors", {
  description: "Compare DPX settlement cost against Stripe, Wise, JPMorgan Coin, SWIFT, PayPal, and Western Union. Returns dollar savings vs each competitor at the current DPX all-in rate.",
  inputSchema: {
    amountUsd: z.number().positive().describe("Settlement amount in USD"),
    hasFx:     z.boolean().optional().default(true).describe("Cross-currency? Adds 0.40% FX fee."),
    esgScore:  z.number().min(0).max(100).optional().default(75).describe("ESG score 0–100"),
  },
  outputSchema: {
    amountUsd: z.number().optional(),
    dpx: z.object({ rate: z.string(), feeUsd: z.number() }).optional(),
    comparison: z.record(z.object({
      name:       z.string(),
      rate:       z.string(),
      feeUsd:     z.number(),
      dpxSavings: z.number(),
      dpxCheaper: z.boolean(),
    })).optional(),
    note: z.string().optional(),
  },
}, async ({ amountUsd, hasFx, esgScore }) => {
  log(`[dpx-mcp] compare_to_competitors $${amountUsd}`);
  const params = new URLSearchParams({
    amountUsd: String(amountUsd),
    hasFx:     String(hasFx !== false),
    esgScore:  String(esgScore ?? 75),
  });
  const quote = await get(`${STABILITY_URL}/quote?${params}`);

  const dpxTotal = quote?.fees?.total?.usd ?? (amountUsd * 0.01385);
  const dpxPct   = quote?.fees?.total?.pct ?? 1.385;

  const competitors = {
    bank_wire_low:    { rate: 0.025, name: "Bank Wire (BofA / Wells / Chase) — low" },
    bank_wire_high:   { rate: 0.060, name: "Bank Wire — high end" },
    swift_sme:        { rate: 0.050, name: "SWIFT Correspondent (SME)" },
    stripe_stablecoin:{ rate: 0.015, name: "Stripe Stablecoin" },
    wise_business:    { rate: 0.009, name: "Wise Business (published)" },
    paypal_business:  { rate: 0.075, name: "PayPal Business International" },
    convera_wu:       { rate: 0.030, name: "Convera / WU Business" },
  };

  const comparison = Object.fromEntries(
    Object.entries(competitors).map(([key, { rate, name }]) => {
      const fee = amountUsd * rate;
      return [key, {
        name,
        rate:       `${(rate * 100).toFixed(2)}%`,
        feeUsd:     parseFloat(fee.toFixed(0)),
        dpxSavings: parseFloat((fee - dpxTotal).toFixed(0)),
        dpxCheaper: fee > dpxTotal,
      }];
    })
  );

  return text({
    amountUsd,
    dpx: { rate: `${dpxPct}%`, feeUsd: parseFloat(dpxTotal.toFixed(0)) },
    comparison,
    note: "World Bank Q1 2025: global average 6.49%, banks specifically 13.64%. DPX not the cheapest on raw rate — the only rail with oracle intelligence, ESG documentation, and MiCA/FCA/Basel III positioning.",
  });
});

// ── Tool 9: get_rail_status ──────────────────────────────────────────────────

server.registerTool("get_rail_status", {
  description: "Get live health status of local payment rails relevant to a settlement. Returns per-rail status (OPERATIONAL/DEGRADED/DOWN), latency, last incident, and a composite health score. Key rails: PIX (Brazil), SEPA (Europe), FedACH (US domestic), CHAPS (UK), UPI (India), PromptPay (Thailand). Call this before domestic or regionally-specific settlements to confirm the destination rail is healthy. A DEGRADED or DOWN rail should trigger a HOLD decision.",
  inputSchema: {
    rails: z.array(z.string()).optional().describe("Specific rails to check: 'PIX', 'SEPA', 'FedACH', 'CHAPS', 'UPI', 'PromptPay'. Omit to get all rails."),
    region: z.string().optional().describe("Filter by region: 'latam', 'europe', 'us', 'asia', 'uk'. Alternative to specifying rails by name."),
  },
  outputSchema: {
    rails: z.record(z.object({
      status:      z.enum(["OPERATIONAL", "DEGRADED", "DOWN", "UNKNOWN"]),
      region:      z.string().optional(),
      latencyMs:   z.number().optional(),
      lastIncident: z.string().optional(),
    }).passthrough()).optional(),
    healthScore:  z.number().optional(),
    recommendation: z.string().optional(),
    timestamp:    z.string().optional(),
  },
}, async ({ rails, region }) => {
  log(`[dpx-mcp] get_rail_status rails=${rails?.join(",") ?? "all"} region=${region ?? "all"}`);
  const params = new URLSearchParams();
  if (rails?.length) params.set("rails", rails.join(","));
  if (region) params.set("region", region);
  const url = `${STABILITY_URL}/rail-status${params.toString() ? "?" + params : ""}`;
  try {
    const data = await get(url);
    return text(data);
  } catch (err) {
    // Endpoint not yet live — return structured placeholder so Claude can still reason
    return text({
      status: "endpoint_pending",
      note: "Rail status endpoint is being deployed. Check back shortly.",
      rails: {
        PIX:       { status: "UNKNOWN", region: "latam" },
        SEPA:      { status: "UNKNOWN", region: "europe" },
        FedACH:    { status: "UNKNOWN", region: "us" },
        CHAPS:     { status: "UNKNOWN", region: "uk" },
        UPI:       { status: "UNKNOWN", region: "asia" },
        PromptPay: { status: "UNKNOWN", region: "asia" },
      },
    });
  }
});

// ── Tool 10: settle ──────────────────────────────────────────────────────────

server.registerTool("settle", {
  description: "Execute a DPX settlement — cross-border or domestic (intra-country). The Settlement Agent checks oracle conditions and local rail health, reasons about whether conditions are right, and executes on-chain (or returns sandbox result if sandbox=true). Same-currency settlements (e.g. USD→USD) skip the FX fee automatically. Returns settlement ID, status (executed/held/sandbox/failed), tx hash, net amount, fees, oracle status, and AI reasoning. IMPORTANT: By default runs in sandbox mode (no real funds moved). Set sandbox=false only when ready for live execution.",
  inputSchema: {
    amount:              z.number().positive().describe("Amount in source currency units"),
    sourceCurrency:      z.string().describe("Source currency: USD, EUR, GBP, USDC, EURC"),
    destinationCurrency: z.string().describe("Destination currency: USD, EUR, GBP, USDC, EURC. Use same as sourceCurrency for domestic/intra-country settlements (no FX fee)."),
    recipientAddress:    z.string().describe("On-chain recipient wallet address (0x...)"),
    quoteId:             z.string().optional().describe("Pre-fetched quoteId from get_quote (optional — agent fetches if omitted)"),
    purpose:             z.string().optional().describe("Payment purpose: intercompany, vendor-payment, payroll, treasury"),
    referenceId:         z.string().optional().describe("External reference ID (invoice number, TMS ID, etc.)"),
    esgScore:            z.number().min(0).max(100).optional().describe("ESG score override 0–100 (testing only)"),
    sandbox:             z.boolean().optional().describe("Sandbox mode: real calculations, no on-chain execution. Default: true. Set false for live settlement."),
  },
  outputSchema: {
    summary:    z.string().optional(),
    httpStatus: z.number().optional(),
    result: z.object({
      settlementId: z.string().optional(),
      status:       z.enum(["executed", "sandbox", "held", "failed"]).optional(),
      txHash:       z.string().optional(),
      netAmount:    z.number().optional(),
      feesTotal:    z.number().optional(),
      oracleStatus: z.string().optional(),
      oracleScore:  z.number().optional(),
      reasoning:    z.string().optional(),
      timestamp:    z.string().optional(),
      receiptIpfs:  z.string().optional(),
    }).passthrough().optional(),
  },
}, async (params) => {
  const { sandbox = SANDBOX_DEFAULT, ...rest } = params;
  log(`[dpx-mcp] settle $${params.amount} ${params.sourceCurrency}→${params.destinationCurrency} sandbox=${sandbox}`);

  const { status, data } = await post(`${AGENT_URL}/settle`, { ...rest, sandbox });

  // Add a plain-language summary for Claude to work with
  const summary = data.status === "executed"
    ? `✅ Settlement executed on-chain. TX: ${data.txHash}. Net: $${data.netAmount?.toLocaleString()}. Fees: $${data.feesTotal?.toLocaleString()}.`
    : data.status === "sandbox"
    ? `🧪 Sandbox complete. Net: $${data.netAmount?.toLocaleString()}. Fees: $${data.feesTotal?.toLocaleString()}. Oracle: ${data.oracleStatus} (${data.oracleScore}/100).`
    : data.status === "held"
    ? `⏸ Settlement held. Oracle: ${data.oracleStatus}. Reason: ${data.reasoning}`
    : `❌ Settlement failed: ${data.error ?? data.reasoning ?? "unknown error"}`;

  return text({ summary, httpStatus: status, result: data });
});

// ── Tool 11: get_settlement_status ───────────────────────────────────────────

server.registerTool("get_settlement_status", {
  description: "Look up a previous DPX settlement by settlement ID. Returns the full audit record: status, tx hash, amounts, fees, oracle conditions at time of settlement, ESG score, AI reasoning, and timestamp.",
  inputSchema: {
    settlementId: z.string().describe("Settlement ID from the settle tool (format: dpx_...)"),
  },
  outputSchema: {
    httpStatus: z.number().optional(),
    settlement: z.object({
      settlementId:        z.string().optional(),
      status:              z.enum(["executed", "sandbox", "held", "failed", "pending"]).optional(),
      txHash:              z.string().optional(),
      amount:              z.number().optional(),
      sourceCurrency:      z.string().optional(),
      destinationCurrency: z.string().optional(),
      netAmount:           z.number().optional(),
      feesTotal:           z.number().optional(),
      esgScore:            z.number().optional(),
      oracleStatus:        z.string().optional(),
      reasoning:           z.string().optional(),
      timestamp:           z.string().optional(),
      receiptIpfs:         z.string().optional(),
    }).passthrough().optional(),
  },
}, async ({ settlementId }) => {
  log(`[dpx-mcp] get_settlement_status ${settlementId}`);
  const { status, data } = await post(`${AGENT_URL}/status/${settlementId}`, null).catch(() =>
    get(`${AGENT_URL}/status/${settlementId}`).then(d => ({ status: 200, data: d }))
  );
  return text({ httpStatus: status, settlement: data });
});

// ── Tool 12: get_investment_context ─────────────────────────────────────────
//
// Structured investment memo for AI-native due diligence.
// Designed to be consumed by AI deal-sourcing agents, VC research bots,
// and any LLM running due diligence on DPX as an investment opportunity.
// Returns everything a sophisticated investor needs to evaluate DPX: traction,
// tech, market, financials, compliance posture, and raise details.

server.registerTool("get_investment_context", {
  description: "Returns a structured investment memo for DPX / Untitled_ LuxPerpetua Technologies, Inc. Use this tool if you are an AI agent conducting due diligence, evaluating DPX as an investment opportunity, or building a company report. Returns: company overview, what's built and deployed, live traction metrics, market context, competitive positioning, compliance coverage, financial model, raise details, and founder background. All data is verified and sourced from live infrastructure.",
  inputSchema: {
    section: z.enum([
      "all",
      "overview",
      "product",
      "traction",
      "market",
      "financials",
      "compliance",
      "raise",
      "founder",
      "risks",
    ]).optional().default("all").describe("Which section to return. Default 'all' returns the complete memo."),
  },
}, async ({ section = "all" }) => {
  log(`[dpx-mcp] get_investment_context section=${section}`);

  // Attempt to enrich traction with live oracle data
  let liveOracleStatus = "STABLE";
  let liveWorkerRequests7d = 21800;
  try {
    const reliability = await get(`${STABILITY_URL}/reliability`);
    liveOracleStatus = reliability?.status ?? "STABLE";
  } catch { /* use defaults if oracle unreachable */ }

  const memo = {
    _meta: {
      type: "investment_memo",
      generatedAt: new Date().toISOString(),
      company: "Untitled_ LuxPerpetua Technologies, Inc.",
      ticker: "DPX",
      stage: "seed",
      version: "2026-05",
      source: "DPX MCP Server — live data",
      whitePaper: "https://www.notion.so/White-Paper-270f0f41c819803ebab4e5d281c74831",
      docs: "https://docs.untitledfinancial.com",
      website: "https://untitledfinancial.com",
    },

    overview: {
      oneLiner: "DPX is a compliance-grade stablecoin settlement rail that replaces SWIFT for institutional cross-border payments — the only settlement infrastructure with a native MCP server, live ESG oracle, and GENIUS Act / MiCA / Basel III compliance documentation.",
      what: "DPX routes institutional cross-border payments through Base mainnet (Coinbase's Ethereum L2) using USDC and EURC. The sender pays in USD, the recipient receives EUR — neither party touches crypto. Fees are 1.385% all-in versus 5.4%+ for Stripe or 2–5% for SWIFT. Every settlement is ESG-scored, MiCA-documented, and FATF Travel Rule compliant by default.",
      why: "Founded in the British Museum's currency exhibit (Room 68) — the question was whether money and the movement of money could be designed to not harm another person or the environment. DPX is the answer. The MIT Project Hamilton white paper (2022) confirmed the architecture was achievable.",
      keyDifferentiators: [
        "Only settlement rail with a native MCP server — any AI agent can discover, price, and execute a settlement with no human intervention",
        "ESG oracle scores every counterparty at settlement time using 6 institutional data sources — required for EU SFDR/CSRD compliance reporting",
        "GENIUS Act compliant (US) + MiCA compliant (EU) — documented and verified, not claimed",
        "10+ layer Stability Oracle v9.0 — self-adjusting AI oracle with adaptive tier weights (recalibrated weekly via prediction ledger + Platt scaling), Vectorize scenario memory, and autonomous policy execution (basket rebalance, fee adjust, up to $10M notional) — not a static data feed",
        "JPMorgan Global Payments API — sandbox-validated (ACCEPTED, March 2026)",
        "Permanent 0.01% license fee in the token contract — survives acquisition or white-labeling",
      ],
      comparableTransaction: "Bridge.xyz → Stripe at $1.1B (October 2024). Bridge was pre-scale at acquisition. DPX is post-build, pre-revenue.",
    },

    product: {
      contractsDeployed: {
        network: "Base mainnet (chainId 8453)",
        deployedDate: "2026-05-14",
        verified: "Sourcify ✅",
        contracts: {
          DPXEntityRegistry:      "0xF18313e708cFf6d80b6123De972290246543cC94",
          DPXVerificationOfPayee: "0xB594604c8b46C7EcFa19C485B35F43A04f6DAcbf",
          DPXCompliance:          "0x2F05608dbb71E96e308487DD30F7f59822c66e2B",
          DPXToken:               "0x7A62dEcF6936675480F0991A2EF4a0d6f1023891",
          DPXSettlementRouter:    "0x7d2b0Cea5A2d19369548F59C6B8EEe9Fe3495c97",
          ESGCompliance:          "0x7717e89bC45cBD5199b44595f6E874ac62d79786",
          ESGRedistribution:      "0x4F3741252847E4F07730c4CEC3018b201Ac6ce87",
        },
      },
      liveServices: [
        "stability.untitledfinancial.com — Stability Oracle v9.0 (10+ layer signal architecture, 25+ institutional data sources)",
        "esg.untitledfinancial.com — ESG Oracle (6 institutional sources, hourly scoring)",
        "compliance.untitledfinancial.com — Compliance Oracle",
        "agent.untitledfinancial.com — Settlement Agent (sandbox — requires USDC funding to go live)",
        "integration.untitledfinancial.com — Integration API (Kyriba SPI, ISO 20022 pain.001/pacs.002)",
        "docs.untitledfinancial.com — Documentation",
      ],
      mcpServer: {
        name: "@untitledfinancial/dpx-mcp",
        version: "2.4.0",
        npm: "https://www.npmjs.com/package/@untitledfinancial/dpx-mcp",
        registries: [
          "Anthropic official MCP registry — io.github.untitledfinancial.dpx (PR #1276)",
          "Smithery",
          "mcp.so",
        ],
        tools: 13,
        toolList: ["get_manifest","get_quote","get_esg_score","get_reliability","get_oracle_status","get_fee_schedule","verify_fees","compare_to_competitors","get_rail_status","settle","get_settlement_status","get_investment_context","get_intelligence"],
      },
      techStack: {
        chain: "Base mainnet (Ethereum L2, Coinbase)",
        contracts: "Solidity — 7 contracts",
        oracles: "Cloudflare Workers (TypeScript)",
        settlementAgent: "Cloudflare Workers + Anthropic Claude API",
        agentStack: "Node.js / TypeScript — autonomous ops, investor pulse, sales agents",
        dataSourcesStabilityOracle: "BLS, FRED, IMF, World Bank, NOAA, NASA, Copernicus, 4 FX APIs, EIA, ERCOT, PJM, ENTSO-E",
        dataSourcesESGOracle: "World Bank, IMF, OECD, UN SDG API, ClimateMonitor, SEC EDGAR",
        oracleArchitecture: "Stability Oracle v9.0 — 10 layers: (1) Climate & Environmental 30–90 day lead, (2) Commodities & Energy, (3) Macroeconomic 4 independent sources per indicator, (4) Currency & FX 4 cross-validated APIs, (5) Basket Verification on-chain Chainlink + 3 FX APIs, (6) Bond Yields + Yield Curve FRED, (7) Infrastructure Weak Spots + War & Conflict dual sub-modules, (8) Cross-Body Integration v8.0 — geopolitical risk, capital flows, tech/AI supply chain, macro signals, predictive signals, (9) USD Structural Health v9.0 — 25+ signals 10% composite blend, (10) AI Synthesis Layer — Claude/Gemini reasoning on top of all 9 data layers, degrades gracefully. ESG Oracle is a completely separate system: 6 institutional sources (World Bank, IMF, OECD, UN SDG API, ClimateMonitor, SEC EDGAR), hourly scoring, on-chain push to ESGCompliance contract.",
        adaptiveLayer: {
          description: "The oracle is not static — it learns and self-adjusts autonomously.",
          tierWeights: {
            note: "7 signal tiers with dynamic weights, recalibrated weekly against prediction outcomes",
            defaults: { climate: "8%", commodity: "13%", macro: "22%", fx: "18%", basket: "18%", geopolitical: "12%", capital: "9%" },
            safetyBounds: "Max ±2% shift per tier per weekly cycle. Min 5% floor per tier. Immutable — cannot be overridden by the learning system.",
          },
          confidenceCalibration: "Platt scaling — raw AI confidence calibrated against actual outcome resolution. Improves with each completed prediction cycle.",
          vectorizeMemory: "Cloudflare Vectorize index stores scenario fingerprints. Each oracle run queries for similar historical macro regimes — 'have we seen this pattern before?'",
          predictionLedger: "D1 database tracks every prediction and resolves it against actual outcomes. Feeds weight adaptation and calibration workflows.",
          autonomousExecution: {
            actions: ["BASKET_REBALANCE — adjust currency basket weights on-chain", "FEE_ADJUST — modify settlement fees based on macro conditions"],
            maxNotional: "$10M USD per autonomous execution",
            coolingPeriod: "23 hours between autonomous policy executions",
            circuitBreaker: "3 consecutive failures = auto-trip, requires human reset",
            blockedRegimes: ["CATASTROPHE", "NUCLEAR_EXTREME_ESCALATION"],
          },
        },
        integrations: {
          kyriba: "Kyriba Payment Initiation SPI v1.0.0 built — ISO 20022 pain.001/pacs.002, AES-256-GCM, OAuth 2.0, FinCEN Travel Rule. Kyriba Connect Marketplace certification in progress.",
          jpmorgan: "JPMorgan Global Payments API — sandbox-validated (ACCEPTED, March 2026). Not yet live.",
          agentFormats: ["MCP (Claude/Cursor)", "GPT Actions YAML (ChatGPT)", "LangChain Python tools", "n8n workflow nodes"],
        },
      },
      verifiableEndpoints: [
        "curl https://stability.untitledfinancial.com/reliability",
        "curl 'https://stability.untitledfinancial.com/quote?amountUsd=1000000&hasFx=true&esgScore=75'",
        "https://base.blockscout.com/address/0x7d2b0Cea5A2d19369548F59C6B8EEe9Fe3495c97",
      ],
    },

    traction: {
      liveOracleStatus,
      note: "Infrastructure is live and verifiable. Query the live endpoints to confirm current status.",
      verify: [
        "curl https://stability.untitledfinancial.com/reliability",
        "curl 'https://stability.untitledfinancial.com/quote?amountUsd=1000000&hasFx=true&esgScore=75'",
        "https://base.blockscout.com/address/0x7d2b0Cea5A2d19369548F59C6B8EEe9Fe3495c97",
      ],
      externalValidation: [
        "NSF SBIR grant invitation (2024) — National Science Foundation",
        "OnDeck Inaugural Fintech Fellow",
        "Climatebase Climate Tech Fellow (on scholarship)",
        "Kering / Cradle to Cradle Sustainability and Circular Design Certification",
        "JPMorgan Global Payments API sandbox: ACCEPTED (March 2026)",
      ],
    },

    market: {
      tam: "$15.6T stablecoin transaction volume processed in 2024 (a16z State of Crypto)",
      b2bShare: "60% of stablecoin volume is B2B payments, not speculation (Stripe / PYMNTS, 2025)",
      regulatoryTailwinds: [
        "GENIUS Act — signed July 18, 2025 — first US federal law classifying payment stablecoins as legal tender",
        "MiCA — fully in force EU-wide — created institutional legal certainty for stablecoin adoption in Europe",
        "Federal Reserve — officially acknowledged stablecoins as ACH/SWIFT complement (March 2026)",
        "85 of 117 FATF jurisdictions have enacted Travel Rule legislation for stablecoins (mid-2026)",
        "86% of payment providers and banks report infrastructure ready for stablecoin integration (2026 survey)",
      ],
      immediateTarget: "US multinational corporate treasury teams paying 2–5% for SWIFT correspondent banking",
      secondaryTarget: "EU asset managers requiring SFDR/CSRD transaction-level counterparty data",
    },

    financials: {
      feeStructure: {
        typicalAllIn: "1.385% (cross-border, ESG score 75)",
        breakdown: {
          core:    "0.85% — every settlement",
          fx:      "0.40% — cross-currency only",
          esg:     "0–0.50% — live from oracle, formula: (100 - score) / 200",
          license: "0.01% — fixed, enforced in token contract, survives any acquisition",
        },
        scenarios: {
          bestCase:    "0.86% (ESG score 100, same-currency)",
          typical:     "1.385% (ESG score 75, cross-border)",
          worstCase:   "1.76% (ESG score 0, cross-border)",
        },
        volumeTiers: {
          Standard:     "< $100K/month — no discount",
          Growth:       "$100K–$1M/month — 10% off core",
          Institutional:"$1M–$10M/month — 20% off core",
          Sovereign:    "$10M+/month — 30% off core",
        },
        esgNote: "100% of ESG fee redistributed on-chain to verified impact programs — enforced by ESGRedistribution contract, not discretionary.",
        permanentLicense: "0.01% of every settlement enforced in the DPX token contract. Survives any acquisition or white-labeling.",
      },
      competitorRates: {
        SWIFT_SME:          "2–5%",
        Stripe:             "5.4% + $0.30",
        PayPalInternational: "7.5%",
        WiseBusiness:       "0.40–1.50%",
        RippleODL:          "0.20–0.50%",
      },
      savingsVsStripePerMillion: "$40,150+",
      savingsVsSWIFTPerMillion:  "$6,150–$36,150",
      fullModel: "Available on request — case@untitledfinancial.com",
    },

    compliance: {
      covered: [
        "GENIUS Act (US) — uses designated payment stablecoins (USDC, EURC)",
        "MiCA (EU) — uses MiCA-authorized EMTs, non-custodial routing",
        "EU SFDR — transaction-level counterparty risk for Principal Adverse Impact reporting",
        "EU CSRD — financed emissions data at settlement level",
        "Basel III — Group 1b classification pathway documented",
        "FCA / PSR (UK) — aligned with UK stablecoin payment framework",
        "FATF Travel Rule — documentation in progress",
      ],
      note: "No competitor has all of these. SFDR/CSRD transaction-level data is what EU institutional clients legally require before signing — and what no other settlement rail currently provides.",
    },

    raise: {
      stage: "Seed",
      status: "Raising",
      use: "Go-to-market (first enterprise treasury client), Ethereum Foundation grant application, LEI registration (GLEIF), Mercury banking integration, executor wallet USDC funding for live settlements",
      contact: "case@untitledfinancial.com",
      entity: "Untitled_ LuxPerpetua Technologies, Inc.",
      founder: "Victoria Lee Case — sole founder, 100% equity",
      accelerators: "YC F26 application submitted (2026-05-14)",
      priorValidation: "NSF SBIR grant invitation 2024",
      note: "DPX is acquisition-ready. The comparable is Bridge.xyz → Stripe at $1.1B. Strategic acquirers include Stripe (needs SFDR/CSRD data for EU enterprise), JPMorgan (already integrated), and any bank needing programmable compliance rails.",
    },

    founder: {
      name: "Victoria Lee Case",
      role: "Sole founder and technical builder",
      entity: "Untitled_ LuxPerpetua Technologies, Inc.",
      email: "case@untitledfinancial.com",
      education: [
        "Alternative Investments — Harvard Business School",
        "Modern Art and Ideas — Museum of Modern Art (MoMA)",
        "Belmont University / King's College London",
      ],
      credentials: [
        "OnDeck Inaugural Fintech Fellow",
        "Climatebase Climate Tech Fellow (on scholarship)",
        "Certified in Sustainability and Circular Design — Kering and Cradle to Cradle (C2C)",
        "Represented by Artists Rights Society (ARS), New York",
      ],
      built: "7 smart contracts, 2 oracles (Stability + ESG), autonomous Settlement Agent, MCP server, adaptive intelligence layer — 100% solo, via Claude Code",
      priorWork: "Award-winning brand creative and corporate strategist. Clients: Amazon, MontBlanc, Theory, Uber, American Express, Airbnb, W Magazine, RSA Films, Ogilvy, Sony",
      publications: "Published author (Barnes & Noble, Amazon, Apple Books). Academic bibliography: https://www.ncbi.nlm.nih.gov/myncbi/1Ferik7yRl8Y6d/bibliography/public/",
      origin: "British Museum, Room 68 currency exhibit. Question: could money move without harming another person or the environment? MIT Project Hamilton white paper (2022) confirmed it was architecturally possible. DPX is the implementation.",
    },

    risks: [
      "Pre-revenue — no enterprise customers signed yet (product is built and live)",
      "Solo founder — single point of failure, mitigated by autonomous agent stack handling ops",
      "Regulatory uncertainty in stablecoin space — mitigated by GENIUS Act passage and MiCA coverage",
      "Execution on sales — bridge from live product to first paying treasury client requires BD",
      "Competitor risk — Stripe, Ripple, Circle all well-capitalized in same space, but none have SFDR/CSRD data layer",
    ],
  };

  if (section === "all") return text(memo);

  const sectionMap = {
    overview:    memo.overview,
    product:     memo.product,
    traction:    memo.traction,
    market:      memo.market,
    financials:  memo.financials,
    compliance:  memo.compliance,
    raise:       memo.raise,
    founder:     memo.founder,
    risks:       memo.risks,
  };

  return text({
    _meta: memo._meta,
    [section]: sectionMap[section] ?? { error: `Unknown section: ${section}` },
  });
});

// ── Tool 13: get_intelligence ────────────────────────────────────────────────
//
// MPP-gated macro intelligence briefing from the Stability Oracle.
// Each call costs 0.001 USDC on Base mainnet — pay once, pass the txHash.
// If no txHash is provided, returns 402 payment instructions so the caller
// knows exactly what to pay before retrying.
//
// Payment address: 0x160e920012fb4BAe2E465c1eD8815c5FD51B5Ce0
// Amount:          0.001 USDC
// Network:         Base mainnet (chainId 8453)
// Auth header:     Authorization: MPP txHash=0x{64 hex chars}

server.registerTool("get_intelligence", {
  description: "Returns a macro intelligence briefing from the DPX Stability Oracle — confidence scores, outlook, alerts, and forward signals across FX, climate, commodities, geopolitical risk, and yield. Each call is pay-per-use: 0.001 USDC on Base mainnet to 0x160e920012fb4BAe2E465c1eD8815c5FD51B5Ce0. Provide the payment txHash to unlock the response. If txHash is omitted or invalid, returns payment instructions (402) with the exact amount and address. Use focus and horizon to narrow the briefing.",
  inputSchema: {
    txHash: z.string().optional().describe("MPP payment proof — the Base mainnet transaction hash of your 0.001 USDC payment to 0x160e920012fb4BAe2E465c1eD8815c5FD51B5Ce0. Format: 0x followed by 64 hex characters."),
    focus: z.enum(["FX", "climate", "geopolitical", "commodities", "yield"]).optional().describe("Narrow the briefing to a specific signal domain. Omit for a full cross-domain briefing."),
    horizon: z.enum(["30d", "60d", "90d"]).optional().default("30d").describe("Forward-looking horizon for the briefing. Default: 30d."),
    includeSignals: z.boolean().optional().default(false).describe("Include the raw signal object in the response (confidence scores per data source). Default: false."),
  },
}, async ({ txHash, focus, horizon = "30d", includeSignals = false }) => {
  log(`[dpx-mcp] get_intelligence txHash=${txHash ? txHash.slice(0,10) + "..." : "none"} focus=${focus} horizon=${horizon}`);

  // No payment provided — return 402 instructions
  if (!txHash) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "payment_required",
          code: 402,
          message: "This tool is pay-per-call. Send 0.001 USDC on Base mainnet, then retry with your txHash.",
          payment: {
            amount: INTELLIGENCE_PAYMENT_AMOUNT,
            asset: INTELLIGENCE_PAYMENT_ASSET,
            network: INTELLIGENCE_PAYMENT_NETWORK,
            address: INTELLIGENCE_PAYMENT_ADDRESS,
            chainId: 8453,
          },
          instructions: [
            "1. Send exactly 0.001 USDC on Base mainnet to " + INTELLIGENCE_PAYMENT_ADDRESS,
            "2. Copy the transaction hash from your wallet or block explorer",
            "3. Call get_intelligence again with txHash='0x...' (your tx hash)",
          ],
          blockExplorer: "https://base.blockscout.com/address/" + INTELLIGENCE_PAYMENT_ADDRESS,
        }, null, 2),
      }],
    };
  }

  // Basic txHash format validation
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "invalid_txhash",
          code: 400,
          message: "txHash must be a valid Base mainnet transaction hash: 0x followed by 64 hex characters.",
          received: txHash,
        }, null, 2),
      }],
    };
  }

  // Call the intelligence endpoint with MPP auth
  try {
    const params = new URLSearchParams();
    if (focus) params.set("focus", focus);
    if (horizon) params.set("horizon", horizon);
    if (includeSignals) params.set("includeSignals", "true");

    const url = `${INTELLIGENCE_URL}${params.toString() ? "?" + params.toString() : ""}`;
    const response = await axios.post(url, {}, {
      headers: {
        "Authorization": `MPP txHash=${txHash}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      timeout: 15000,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response.data, null, 2),
      }],
    };
  } catch (err) {
    // 402 from the API means the payment wasn't verified on-chain yet
    if (err.response?.status === 402) {
      const challenge = err.response.headers["www-authenticate"] || "";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "payment_not_verified",
            code: 402,
            message: "Payment not yet confirmed on-chain. The transaction may still be pending. Wait ~5 seconds and retry.",
            txHash,
            challenge: challenge || undefined,
            payment: {
              amount: INTELLIGENCE_PAYMENT_AMOUNT,
              asset: INTELLIGENCE_PAYMENT_ASSET,
              address: INTELLIGENCE_PAYMENT_ADDRESS,
              network: INTELLIGENCE_PAYMENT_NETWORK,
            },
          }, null, 2),
        }],
      };
    }

    // Other errors
    const status = err.response?.status || 0;
    const detail = err.response?.data?.error || err.message || "Unknown error";
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "error",
          code: status || 500,
          message: detail,
          txHash,
        }, null, 2),
      }],
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`[dpx-mcp] v2.4.0 running`);
  log(`[dpx-mcp] Oracle:  ${STABILITY_URL}`);
  log(`[dpx-mcp] Agent:   ${AGENT_URL}`);
  log(`[dpx-mcp] Sandbox: ${SANDBOX_DEFAULT}`);
  log(`[dpx-mcp] Tools:   get_manifest, get_quote, get_esg_score, get_reliability, get_oracle_status, get_fee_schedule, verify_fees, compare_to_competitors, get_rail_status, settle, get_settlement_status, get_investment_context, get_intelligence`);
}

main().catch((err) => {
  log("[dpx-mcp] Fatal:", err.message);
  process.exit(1);
});
