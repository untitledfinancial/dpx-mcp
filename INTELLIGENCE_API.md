# DPX Intelligence API

Standalone per-call data product - a separate Cloudflare Worker from the Stability Oracle. All endpoints use the [x402 protocol](https://x402.org) - USDC on Base mainnet, per-call pricing. No subscriptions, no API keys.

**Worker:** `intelligence-worker/` (this repo)
**Stability Oracle:** `stability-oracle/worker/` (separate worker, separate deploy)

Base URL: `https://intelligence.untitledfinancial.com`

---

## Payment model

Every intelligence endpoint follows the same x402 flow:

1. **Call without payment** ‚Üí `402 Payment Required` JSON with `paymentRequirements`
2. **Attach `X-PAYMENT` header** (base64-encoded signed USDC transfer) ‚Üí verified on-chain via Coinbase x402 facilitator
3. **Response delivered** immediately after verification

Payment address: configured via `FEE_COLLECTOR_ADDRESS` worker secret (defaults to `0x39062...` dev address).
Asset: USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) on Base mainnet.

---

## Endpoints

### `GET /intelligence` - $0.10/call

**AI synthesis over 32+ real-time signals**

Runs the full stability compute pipeline through a Claude AI narrative layer. Returns a prose synthesis of the current macro, climate, FX, geopolitical, and on-chain environment, including risk flags and what each tier is signaling.

**Response headers**
```
X-DPX-Score: <stability score 0-100>
X-DPX-Tier: <STABLE | WATCH | STRESSED | CRITICAL>
```

**Response shape (abbreviated)**
```json
{
  "score": 74,
  "tier": "WATCH",
  "narrative": "...",
  "alerts": [...],
  "generatedAt": "2026-05-15T12:00:00Z"
}
```

---

### `GET /intelligence/climate` - $0.25/call | 24h cache

**Structural precipitation shift analysis across 10 global agricultural production zones**

Compares recent 3-year precipitation (2021-2023) against a 1972-1974 baseline using ERA5 reanalysis data via Open-Meteo. Maps anomalies to commodity exposure, food system cascade risk, migration pressure, and basket currency implications.

**Data sources**
| Source | Data | Update cadence |
|---|---|---|
| Open-Meteo Historical Archive (ERA5) | Monthly precipitation 1940-present | Annual reanalysis |

**Agricultural regions covered**
| Region | Key commodities |
|---|---|
| US Great Plains | Wheat, corn, soy (staples) |
| US Corn Belt | Corn, soy |
| Amazon / Cerrado | Soy, beef, coffee |
| Sahel | Millet, sorghum (staples) |
| South Asia (Ganges) | Rice, wheat (staples) |
| Southeast Asia (Mekong) | Rice (staple) |
| Murray-Darling (Australia) | Wheat, barley |
| Central Asia (Aral Basin) | Cotton, wheat |
| East Africa | Coffee, tea, maize |
| Mediterranean | Olive oil, citrus, wheat |

**Shift classifications**
```
CRITICAL     ‚â§ -25% vs baseline
SIGNIFICANT  ‚â§ -15%
NOTABLE      ‚â§ -8%
EMERGING     ‚â§ -3%
STABLE       > -3%
```

**Response shape (abbreviated)**
```json
{
  "generatedAt": "2026-05-15T12:00:00Z",
  "cacheHit": false,
  "summary": {
    "globalFoodSystemRisk": "ELEVATED",
    "regionsAtRisk": 4,
    "criticalCommodities": ["wheat", "rice"],
    "cascadeSignals": [...]
  },
  "regions": [...],
  "commoditySignals": [...],
  "transmission": {
    "foodInflationPressure": "HIGH",
    "migrationPressure": "MODERATE",
    "basketImplications": {...}
  }
}
```

**Response headers**
```
X-DPX-Climate-Score: <global food system risk score>
X-DPX-Cache-Hit: true | false
X-DPX-Generated: <ISO timestamp>
```

---

### `GET /intelligence/earth-systems` - $0.50/call | 48h cache

**Planetary health dashboard with 50-100 year historical context**

Pulls live atmospheric, cryosphere, and ocean data from NASA, NOAA, and NSIDC. Computes an Earth Health Index (0-100, where 100 = pre-industrial health) and assesses proximity to 9 known climate tipping points through a sustainability lens.

**Data sources**
| Source | Data | Coverage |
|---|---|---|
| NOAA GML - Mauna Loa (`co2_mm_mlo.txt`) | Atmospheric CO‚ÇÇ (ppm) | 1958-present |
| NOAA GML - Global CH‚ÇÑ (`ch4_mm_gl.txt`) | Atmospheric methane (ppb) | 1983-present |
| NASA GISTEMP v4 (`GLB.Ts+dSST.txt`) | Global surface temp anomaly | 1880-present |
| NSIDC Sea Ice Index v3.0 (`N_09_extent_v3.0.csv`) | Arctic September minimum extent | 1979-present |
| Open-Meteo Marine API | SST proxy (North Atlantic 30¬∞N 45¬∞W) | Real-time |

**Earth Health Index composition**
| Component | Weight | Signal |
|---|---|---|
| Temperature anomaly (vs 1850-1900 pre-industrial) | 35% | NASA GISTEMP |
| CO‚ÇÇ exceedance above 280 ppm baseline | 25% | NOAA Mauna Loa |
| Arctic sea ice loss since 1979 | 20% | NSIDC |
| CH‚ÇÑ exceedance above 700 ppb baseline | 10% | NOAA GML |
| SST anomaly | 10% | Open-Meteo Marine |

**Tipping points assessed (9)**
| Tipping point | Threshold | Cascade risk |
|---|---|---|
| Greenland Ice Sheet | +1.5¬∞C sustained | Sea level +7m |
| West Antarctic Ice Sheet | +1.5-2.0¬∞C | Sea level +3.3m |
| Amazon dieback | 20-25% deforestation + drought | Global carbon store collapse |
| AMOC (Atlantic circulation) | Freshwater flux + temp | EU cooling, monsoon shift |
| Permafrost carbon feedback | +2¬∞C Arctic | Irreversible CH‚ÇÑ release |
| Arctic summer sea ice | +1.5¬∞C | Albedo feedback acceleration |
| Tropical coral reefs | +1.5¬∞C + acidification | Marine food web collapse |
| South Asian monsoon disruption | Aerosol + temp interaction | 2B people food/water |
| Boreal forest dieback | Drought + fire + beetle | Northern carbon sink loss |

Each tipping point returns: `proximityRisk` (BREACHED / IMMINENT / HIGH / MODERATE / LOW), `timeHorizon`, `cascadeRisk` description.

**Historical reference points used**
| Metric | Pre-industrial (1750) | 50 years ago (1974) | 100 years ago (1924) |
|---|---|---|---|
| CO‚ÇÇ | 280 ppm | 330 ppm | 305 ppm |
| CH‚ÇÑ | 700 ppb | 1,450 ppb | 1,100 ppb |
| Temp anomaly | 0.0¬∞C | +0.1¬∞C | -0.1¬∞C |
| Arctic sea ice | ~7.5 Mkm¬≤ | ~7.2 Mkm¬≤ | ~7.5 Mkm¬≤ |

**Response shape (abbreviated)**
```json
{
  "generatedAt": "2026-05-15T12:00:00Z",
  "cacheHit": false,
  "earthHealthIndex": 61,
  "planetaryStatus": "ELEVATED",
  "methodology": "...",
  "atmosphere": {
    "co2": {
      "currentPpm": 424.5,
      "preindustrialPpm": 280,
      "fiftyYearsAgoPpm": 330,
      "hundredYearsAgoPpm": 305,
      "changeSince50y": "+28.6%",
      "changeSincePreind": "+51.6%",
      "annualIncreasePpm": 2.4,
      "exceedancePct": 51.6,
      "signal": "CRITICAL",
      "historicalValues": [{ "year": 1960, "ppm": 317.0 }, "..."]
    },
    "methane": { "..." },
    "temperature": {
      "currentAnomalyC": 1.29,
      "anomaly50yAgoC": 0.1,
      "warmingRatePerDecade": 0.19,
      "distanceToParisC": 0.21,
      "signal": "CRITICAL"
    }
  },
  "cryosphere": {
    "arcticSeaIce": {
      "septemberExtentMkm2": 4.3,
      "lossSince1979Pct": -43.2,
      "linearTrendPerDecadeMkm2": -0.87,
      "recordLowMkm2": 3.41,
      "yearsToIceFreeEstimate": 15,
      "signal": "CRITICAL"
    }
  },
  "ocean": { "..." },
  "tippingPoints": [
    {
      "name": "Arctic Summer Sea Ice",
      "proximityRisk": "IMMINENT",
      "threshold": "+1.5¬∞C",
      "currentStatus": "1.29¬∞C - threshold crossed in hot years",
      "timeHorizon": "2030-2040",
      "cascadeRisk": "Albedo feedback accelerates warming; opens Arctic shipping lanes permanently"
    },
    "..."
  ],
  "sustainability": {
    "earthHealthIndex": 61,
    "planetaryStatus": "ELEVATED",
    "atmosphericHealth": "...",
    "cryosphereHealth": "...",
    "oceanHealth": "...",
    "biosphereHealth": "...",
    "humanImplication": "...",
    "generationalContext": "...",
    "immediateSignals": ["..."],
    "tippingPointAlert": "..."
  }
}
```

**Response headers**
```
X-DPX-Earth-Health-Index: <0-100>
X-DPX-Cache-Hit: true | false
X-DPX-Generated: <ISO timestamp>
```

---

## Pricing summary

| Endpoint | Price | Cache TTL | Status | Primary use case |
|---|---|---|---|---|
| `/intelligence` | $0.10 | none (live) | Live | AI narrative synthesis, real-time signal read |
| `/intelligence/climate` | $0.25 | 24h | Live | Agricultural commodity exposure, food inflation signals |
| `/intelligence/earth-systems` | $0.50 | 48h | Live | Planetary health, tipping point proximity, ESG context |
| `/intelligence/macro-stress` | $0.15 | 1h | Live | Credit regime classification, spread compression signals |
| `/intelligence/supply-chain` | $0.25 | 6h | Live | Lane bottleneck scoring, goods inflation lead signals |
| `/intelligence/energy-transition` | $0.25 | 24h | Live | Renewable share, grid carbon intensity, fossil demand curve |
| `/intelligence/esg/:address` | $0.25 | 6h | Live | Entity-level ESG score from GLEIF, EDGAR, EPA, OSHA |

---

## Additional endpoints

### `GET /intelligence/macro-stress` - $0.15/call | 1h cache

**Credit regime classification across spread, volatility, and lending signals**

Synthesizes FRED credit series into a unified stress index and regime label. Provides lead signals for tightening/easing cycles that precede FX and commodity moves by 2-6 weeks.

**Data sources**
| Source | Series | Signal |
|---|---|---|
| FRED | BAMLC0A0CM - Investment-grade OAS | Credit risk premium |
| FRED | BAMLH0A0HYM2 - High-yield OAS | Junk spread, risk appetite |
| FRED | TEDRATE - TED spread | Interbank funding stress |
| FRED | VIXCLS - CBOE VIX | Equity volatility regime |
| FRED | DRTSCILM - C&I loan tightening | Bank credit availability |

**Response shape**
```json
{
  "stressIndex": 42,
  "regime": "LATE_CYCLE",
  "components": {
    "igSpreadOas": { "value": 98, "signal": "ELEVATED", "zScore": 1.2 },
    "hySpreadOas": { "value": 340, "signal": "WATCH", "zScore": 0.8 },
    "tedSpread": { "value": 0.28, "signal": "NORMAL" },
    "vix": { "value": 22.1, "signal": "WATCH" },
    "lendingTightening": { "value": 18.5, "signal": "ELEVATED" }
  },
  "leadSignals": {
    "fxImplication": "USD_STRENGTH_RISK",
    "commodityImplication": "DEMAND_COMPRESSION",
    "lookAheadWeeks": 4
  }
}
```

---

### `GET /intelligence/supply-chain` - $0.25/call | 6h cache

**Global shipping lane and goods pipeline bottleneck scoring**

Combines NY Fed Global Supply Chain Pressure Index with live shipping water levels (Rhine/Kaub, Mississippi, Panama Canal watershed, Great Lakes) and container freight proxies. Produces per-lane bottleneck scores and a headline goods inflation lead signal.

**Data sources**
| Source | Data | Coverage |
|---|---|---|
| NY Fed GSCPI | Global supply chain pressure (z-score) | 1997-present |
| WSV Pegelonline | Rhine/Kaub water level (cm) | Real-time |
| USGS NWIS | Mississippi/Memphis gauge | Real-time |
| Open-Meteo | Panama Canal Gatun watershed precipitation proxy | Real-time |
| NOAA CO-OPS | Great Lakes / Michigan-Huron | Real-time |

**Lanes**
- Asia ‚Üí Europe (Suez / Cape of Good Hope)
- Transpacific (LA/Long Beach, Shanghai)
- Transatlantic (Rotterdam, NY/NJ)
- Rhine inland waterway (Germany manufacturing corridor)
- Mississippi (US grain export corridor)
- Panama Canal (LNG, grain, container)

**Response shape**
```json
{
  "gscpiZScore": 0.8,
  "regime": "MODERATELY_STRESSED",
  "lanes": {
    "rhin": { "levelCm": 142, "status": "LOW_WATER", "bottleneckRisk": "HIGH" },
    "mississippi": { "status": "NORMAL" },
    "panamaCanal": { "precipAnomalyPct": -32, "status": "WATCH" }
  },
  "goodsInflationLeadSignal": "UPWARD_PRESSURE",
  "lookAheadWeeks": 6
}
```

---

### `GET /intelligence/energy-transition` - $0.25/call | 24h cache

**Structural energy shift intelligence - renewables, grid carbon, fossil demand curve**

Tracks the pace of the energy transition using EIA generation data, grid carbon intensity proxies, and fossil fuel demand curve signals. Provides structural context for energy price forecasting beyond spot prices.

**Data sources**
| Source | Data | Coverage |
|---|---|---|
| EIA Electric Power Monthly | Renewable generation share by source | Monthly |
| EIA Short-Term Energy Outlook | Fossil fuel demand forecasts | Monthly |
| Open-Meteo | Solar irradiance proxy (capacity factor estimation) | Real-time |
| NOAA | Wind patterns (capacity factor proxy) | Real-time |

**Response shape**
```json
{
  "renewableSharePct": 23.4,
  "renewableTrend": "ACCELERATING",
  "gridCarbonIntensity": { "us": 386, "eu": 241, "unit": "gCO2/kWh" },
  "fossilDemandCurve": "PLATEAUING",
  "transitionSignals": {
    "solarAdditionsGw": 48.2,
    "windAdditionsGw": 31.1,
    "batteryDeploymentGwh": 19.4
  },
  "energyPriceStructuralView": "MEDIUM_TERM_SOFTENING"
}
```

---

### `GET /intelligence/esg/:address` - $0.25/call | 6h cache

**Entity-level ESG score for a given legal entity (Ethereum address or LEI)**

Pulls public regulatory and filing data for a counterparty and synthesizes an ESG score across environmental violations, governance disclosures, and social/labor incidents. Designed for counterparty due diligence in DeFi lending and structured products.

**Data sources**
| Source | Data | Signal |
|---|---|---|
| GLEIF | Legal entity registration, jurisdiction, ownership | Governance baseline |
| SEC EDGAR | ESG disclosures, 10-K risk factors, executive comp | Governance quality |
| EPA ECHO | Environmental violations, penalty history, inspection records | Environmental risk |
| OSHA | Workplace incidents, citations, fatality records | Social/labor risk |

**Response shape**
```json
{
  "address": "0x...",
  "lei": "529900...",
  "entityName": "Acme Corp",
  "esgScore": 68,
  "tier": "ACCEPTABLE",
  "components": {
    "environmental": { "score": 72, "violations": 2, "lastViolation": "2023-04" },
    "social": { "score": 81, "oshaIncidents": 0 },
    "governance": { "score": 55, "edgarDisclosureQuality": "PARTIAL" }
  },
  "flags": ["EPA_PENALTY_HISTORY", "EDGAR_INCOMPLETE_ESG_DISCLOSURE"],
  "recommendedTier": "TIER_2"
}
```

---

## Deployment

```bash
cd intelligence-worker

# 1. Install dependencies
npm install

# 2. Create KV namespace
npm run kv:create
# ‚Üí Copy both IDs into wrangler.toml (id and preview_id)

# 3. Set secrets
wrangler secret put FEE_COLLECTOR_ADDRESS   # Base mainnet wallet - receives USDC payments
wrangler secret put FRED_API_KEY            # fred.stlouisfed.org - free tier (macro-stress)
wrangler secret put EIA_API_KEY             # eia.gov - free tier (energy-transition)

# 4. Deploy
wrangler deploy
```

**Custom domain:** Cloudflare Dashboard ‚Üí Workers ‚Üí dpx-intelligence ‚Üí Settings ‚Üí Triggers ‚Üí Custom Domains ‚Üí `intelligence.untitledfinancial.com`

---

## Example: no-payment flow

```bash
curl https://intelligence.untitledfinancial.com/intelligence/earth-systems
```

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header required",
  "paymentRequirements": [{
    "scheme": "exact",
    "network": "base-mainnet",
    "maxAmountRequired": "0.50",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo": "0x...",
    "resource": "https://intelligence.untitledfinancial.com/intelligence/earth-systems",
    "description": "DPX Earth Systems Intelligence - ..."
  }]
}
```

## Example: paid call (x402 client)

Using the [x402-fetch](https://github.com/coinbase/x402) client library:

```typescript
import { withPaymentInterceptor } from 'x402-fetch';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

const wallet = createWalletClient({ chain: base, transport: http() });
const fetchWithPayment = withPaymentInterceptor(fetch, wallet);

const res = await fetchWithPayment(
  'https://intelligence.untitledfinancial.com/intelligence/earth-systems'
);
const data = await res.json();
console.log(data.sustainability.earthHealthIndex); // e.g. 61
```

---

## Free endpoints (no payment required)

| Endpoint | Description |
|---|---|
| `GET /` | Worker liveness, KV status, endpoint index |
| `GET /health` | Same as `/` |
| `GET /.well-known/x402` | x402 payment discovery manifest |
