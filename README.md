# DPX MCP Server

[![smithery badge](https://smithery.ai/badge/untitledfinancial/dpx-mcp)](https://smithery.ai/servers/untitledfinancial/dpx-mcp)
[![npm version](https://badge.fury.io/js/%40untitledfinancial%2Fdpx-mcp.svg)](https://www.npmjs.com/package/@untitledfinancial/dpx-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**AI-native infrastructure for institutional finance.** DPX exposes a 10-layer intelligence oracle and a compliance-grade cross-border settlement rail as a single MCP server ‚Äî any AI agent can read macro signals, score ESG counterparty risk, and execute settlements with no human in the loop.

**13 tools** ¬∑ **Base mainnet** ¬∑ **GENIUS Act + MiCA + Basel III** ¬∑ **x402 pay-per-call**

---

## What DPX is

DPX is two things built as one system:

**1. An AI intelligence layer** ‚Äî a self-adjusting oracle that synthesizes 32+ real-time signals across climate, macroeconomics, FX, energy transition, supply chain, earth systems, and ESG. The oracle is not a static data feed: it recalibrates tier weights weekly against prediction outcomes (Platt scaling), stores scenario fingerprints in a Vectorize index, and runs a Claude AI synthesis layer on top of all nine data tiers. The intelligence endpoints are a standalone data product: pay-per-call in USDC via x402, no API key required.

**2. A settlement rail** ‚Äî cross-border USDC/EURC settlement on Base mainnet at 1.385% all-in, versus 2‚Äì5% for SWIFT or 5.4% for Stripe. Every settlement is ESG-scored, oracle-gated, and compliant with GENIUS Act (US), MiCA (EU), and Basel III by default. The same AI oracle that generates the intelligence briefings also gates whether a settlement executes.

---

## Intelligence endpoints (standalone data product)

Deployed at `https://intelligence.untitledfinancial.com`. Pay per call in USDC on Base via [x402](https://x402.org) ‚Äî no API key, no subscription.

| Endpoint | Price | Cache | What it returns |
|----------|-------|-------|-----------------|
| `GET /intelligence` | $0.10 | live | AI narrative synthesis across all 32+ signals ‚Äî score, tier, alerts, forward outlook |
| `GET /intelligence/climate` | $0.25 | 24h | Precipitation anomalies across 10 agricultural zones vs 1972‚Äì74 baseline ‚Äî commodity exposure, food inflation signals, basket currency implications |
| `GET /intelligence/earth-systems` | $0.50 | 48h | Planetary health dashboard (Earth Health Index 0‚Äì100) ‚Äî CO‚ÇÇ/CH‚ÇÑ/temp/sea ice vs pre-industrial, proximity to 9 climate tipping points |
| `GET /intelligence/macro-stress` | $0.15 | 1h | Credit regime classification ‚Äî IG/HY OAS spreads, TED, VIX, C&I lending tightening ‚Äî 2‚Äì6 week lead signals for FX and commodity moves |
| `GET /intelligence/supply-chain` | $0.25 | 6h | Lane bottleneck scoring ‚Äî NY Fed GSCPI + live Rhine/Mississippi/Panama/Great Lakes water levels ‚Äî goods inflation lead signal |
| `GET /intelligence/energy-transition` | $0.25 | 24h | Renewable share, grid carbon intensity, fossil demand curve ‚Äî structural energy price context |
| `GET /intelligence/esg/:address` | $0.25 | 6h | Entity-level ESG score from GLEIF + SEC EDGAR + EPA ECHO + OSHA ‚Äî counterparty due diligence |

Data sources: Open-Meteo ERA5, NASA GISTEMP, NOAA GML, NSIDC, FRED (BAMLC0A0CM, BAMLH0A0HYM2, TEDRATE, VIXCLS, DRTSCILM), NY Fed GSCPI, WSV Pegelonline, USGS NWIS, EIA, GLEIF, SEC EDGAR, EPA ECHO, OSHA.

**x402 example ‚Äî no API key:**
```typescript
import { withPaymentInterceptor } from 'x402-fetch';
const fetchWithPayment = withPaymentInterceptor(fetch, wallet);
const data = await (await fetchWithPayment('https://intelligence.untitledfinancial.com/intelligence/macro-stress')).json();
// ‚Üí { stressIndex: 42, regime: "LATE_CYCLE", leadSignals: { fxImplication: "USD_STRENGTH_RISK", ... } }
```

---

## MCP tools (for AI agents)

Install once, use from any MCP-compatible host (Claude Desktop, Cursor, n8n, custom agents).

| Tool | Description |
|------|-------------|
| `get_manifest` | DPX protocol capabilities and contract addresses |
| `get_quote` | Binding fee quote (300s TTL) ‚Äî all-in rate with live ESG adjustment |
| `get_esg_score` | Live ESG score for a wallet address ‚Äî hourly from 6 institutional sources |
| `get_reliability` | Oracle stability status ‚Äî STABLE / CAUTION / UNSTABLE |
| `get_oracle_status` | Full 10-layer Stability Oracle v9.0 output ‚Äî all tier scores, alerts, chaos regime flag, AI briefing |
| `get_fee_schedule` | Complete fee table with volume tiers and competitive benchmarks |
| `verify_fees` | Confirm off-chain quote matches on-chain DPXSettlementRouter |
| `compare_to_competitors` | DPX vs Stripe, Wise, SWIFT, bank wire ‚Äî dollar savings per transaction |
| `get_rail_status` | Live health of local payment rails (PIX, SEPA, FedACH, CHAPS, UPI, PromptPay) |
| `settle` | Execute a settlement ‚Äî cross-border or domestic, sandbox or live |
| `get_settlement_status` | Look up a settlement by ID ‚Äî full audit record |
| `get_investment_context` | Structured investment memo for AI due diligence agents |
| `get_intelligence` | MPP-gated macro intelligence briefing from the Stability Oracle |

---

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dpx": {
      "command": "npx",
      "args": ["-y", "@untitledfinancial/dpx-mcp"]
    }
  }
}
```

Restart Claude Desktop. All 13 tools are immediately available.

### Remote HTTP (no install)

```json
{
  "mcpServers": {
    "dpx": {
      "type": "http",
      "url": "https://mcp.untitledfinancial.com/mcp"
    }
  }
}
```

### Smithery

```bash
npx @smithery/cli install @untitledfinancial/dpx-mcp --client claude
```

---

## Example flows

**AI agent settlement workflow:**
```
Agent: settle $2M USD ‚Üí EUR for 0xRecipient...

get_oracle_status   ‚Üí 10-layer signal check ‚Äî score 81, STABLE, no chaos regime
get_esg_score       ‚Üí counterparty ESG tier confirmed (score 74 ‚Üí 0.15% ESG fee)
get_quote           ‚Üí $27,700 all-in at 1.385%, quoteId valid 300s
verify_fees         ‚Üí on-chain fee matches off-chain quote ‚úì
settle              ‚Üí executed on Base mainnet, txHash + IPFS receipt returned
```

**Intelligence query (x402, no MCP):**
```
AI reads macro-stress ‚Üí regime LATE_CYCLE, USD_STRENGTH_RISK flag ‚Üí agent reduces FX exposure
AI reads climate      ‚Üí wheat CRITICAL in South Asia ‚Üí commodity desk alerted
AI reads earth-systems ‚Üí AMOC proximity HIGH ‚Üí long-horizon risk model updated
```

---

## Oracle architecture

The 10-layer Stability Oracle v9.0 underpins both the intelligence product and the settlement rail:

| Layer | Signal |
|-------|--------|
| 0 ‚Äî Climate & Environmental | 30‚Äì90 day lead indicators |
| 1 ‚Äî Commodities & Energy | Spot + structural signals |
| 2 ‚Äî Macroeconomic | 4 independent sources per indicator |
| 3 ‚Äî Currency & FX | 4 cross-validated APIs |
| 4 ‚Äî Basket Verification | On-chain Chainlink + 3 FX APIs |
| 5 ‚Äî Bond Yields | FRED yield curve |
| 6 ‚Äî Infrastructure + Conflict | Dual sub-modules |
| 7 ‚Äî Cross-Body Integration v8.0 | Geopolitical, capital flows, tech/AI supply chain |
| 8 ‚Äî USD Structural Health v9.0 | 25+ signals, 10% composite blend |
| 9 ‚Äî AI Synthesis | Claude reasoning layer ‚Äî degrades gracefully |

**Adaptive layer:** Tier weights recalibrate weekly against prediction outcomes via Platt scaling. Scenario fingerprints stored in Cloudflare Vectorize. Autonomous policy execution (basket rebalance, fee adjust) up to $10M notional with 23h cooling period and circuit breaker.

---

## Compliance

GENIUS Act (US) ¬∑ MiCA (EU) ¬∑ EU SFDR/CSRD (transaction-level ESG) ¬∑ Basel III ¬∑ FCA/PSR (UK) ¬∑ FATF Travel Rule

---

## Live contracts (Base mainnet)

| Contract | Address |
|----------|---------|
| DPXSettlementRouter | `0x7d2b0Cea5A2d19369548F59C6B8EEe9Fe3495c97` |
| DPXToken | `0x7A62dEcF6936675480F0991A2EF4a0d6f1023891` |
| ESGCompliance | `0x7717e89bC45cBD5199b44595f6E874ac62d79786` |

Verified on Sourcify. Full list: [get_manifest](#mcp-tools-for-ai-agents)

---

## Links

- **Homepage**: [mcp.untitledfinancial.com](https://mcp.untitledfinancial.com)
- **Intelligence API docs**: [INTELLIGENCE_API.md](https://github.com/untitledfinancial/dpx-mcp/blob/main/INTELLIGENCE_API.md)
- **npm**: [@untitledfinancial/dpx-mcp](https://www.npmjs.com/package/@untitledfinancial/dpx-mcp)
- **Smithery**: [smithery.ai/servers/untitledfinancial/dpx-mcp](https://smithery.ai/servers/untitledfinancial/dpx-mcp)
- **Docs**: [docs.untitledfinancial.com](https://docs.untitledfinancial.com)

---

## License

MIT ¬© [Untitled Financial](https://untitledfinancial.com)
