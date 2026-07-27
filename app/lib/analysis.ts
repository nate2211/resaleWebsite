import type { EngagementReport } from "./engagement";
import type { WatchStatusReport } from "./watch-status";
import type { ApparelType } from "./apparel";

export const MARKETPLACES = [
  "Depop", "Grailed", "Poshmark", "Mercari Japan", "JDirectItems Auction",
  "Rakuten", "Rakuten Rakuma", "Bunjang", "Goofish",
] as const;
export const RESALE_MARKETPLACES = ["Depop", "Grailed", "Poshmark"] as const;
export const INTERNATIONAL_MARKETPLACES = [
  "Mercari Japan", "JDirectItems Auction", "Rakuten",
  "Rakuten Rakuma", "Bunjang", "Goofish",
] as const;

export type Marketplace = (typeof MARKETPLACES)[number];
export type TargetMarketplace = Marketplace | "Auto";

export type CompMap = Partial<Record<Marketplace, number[]>>;

export type ImportCosts = {
  proxyFee: number;
  domesticShipping: number;
  internationalShipping: number;
  customsReserve: number;
  currencyConversion: number;
  total: number;
  origin: "Japan" | "South Korea" | "China";
  note: string;
};

export type Listing = {
  id: string;
  title: string;
  brand: string;
  marketplace: Marketplace;
  url: string;
  price: number;
  shipping: number;
  condition: string;
  size: string;
  articleType?: ApparelType;
  sellerRating: number;
  sellerSales: number;
  likes: number;
  ageDays: number;
  /** ISO timestamp when a public listing date is readable. */
  listedAt?: string;
  /** Human-readable provenance for listedAt. */
  dateSource?: string;
  engagement?: EngagementReport;
  watchStatus?: WatchStatusReport;
  image: string;
  description: string;
  compPrices: CompMap;
  authenticitySignals: string[];
  riskSignals: string[];
  imported?: boolean;
  importCosts?: ImportCosts;
  /** Optional buying-agent URL for proxy marketplaces such as Goofish via Superbuy. */
  proxyUrl?: string;
  live?: boolean;
  soldResearchUrl?: string;
  soldEvidence?: {
    title: string;
    price: number;
    url: string;
    marketplace?: Marketplace;
  }[];
  comparableListings?: Record<Marketplace, {
    title: string;
    price: number;
    url: string;
  }[]>;
  /** Human-readable source for AI web-discovered listings. */
  sourceName?: string;
  /** Public hostname retained for filtering and provenance. */
  sourceHost?: string;
  /** True when the listing was found through guarded public-web discovery. */
  webDiscovered?: boolean;
  /** Optional local-model relevance score for the current query. */
  modelRelevance?: number;
  /** Short local-model explanation attached to a discovered result. */
  modelInsight?: string;
};

export type FeeBreakdown = {
  marketplaceFee: number;
  processingFee: number;
  fixedFee: number;
  note: string;
};

export type Opportunity = {
  targetMarketplace: Marketplace;
  expectedSale: number;
  platformFees: number;
  outboundShipping: number;
  reserve: number;
  landedCost: number;
  netProfit: number;
  roi: number;
  margin: number;
  score: number;
  confidence: number;
  compCount: number;
  verdict: "Strong buy" | "Worth a look" | "Pass";
  fees: FeeBreakdown;
};

export const MARKETPLACE_INFO: Record<
  Marketplace,
  {
    color: string;
    tint: string;
    home: string;
    search: (query: string) => string;
    feeSummary: string;
    sourcingOnly?: boolean;
    proxy?: string;
    origin?: "Japan" | "South Korea" | "China";
  }
> = {
  Depop: {
    color: "#ff3f55",
    tint: "#fff0f2",
    home: "https://www.depop.com/",
    search: (query) =>
      `https://www.depop.com/search/?q=${encodeURIComponent(query)}`,
    feeSummary: "US preset: 3.3% + $0.45 processing; no seller commission",
  },
  Grailed: {
    color: "#16171a",
    tint: "#f1f2f4",
    home: "https://www.grailed.com/",
    search: (query) =>
      `https://www.grailed.com/shop?query=${encodeURIComponent(query)}`,
    feeSummary:
      "6% below $120 or 9% at $120+; processing estimate is adjustable",
  },
  Poshmark: {
    color: "#7b2d4f",
    tint: "#f8eef3",
    home: "https://poshmark.com/",
    search: (query) =>
      `https://poshmark.com/search?query=${encodeURIComponent(query)}&type=listings&src=ac`,
    feeSummary: "$2.95 below $15; 20% at $15+",
  },
  "Mercari Japan": {
    color: "#ff3158", tint: "#fff0f4", home: "https://jp.mercari.com/en/",
    search: (query) => `https://jp.mercari.com/en/search?keyword=${encodeURIComponent(query)}&status=on_sale`,
    feeSummary: "Japan source; landed-cost estimator includes shipping, FX, and customs reserve",
    sourcingOnly: true, origin: "Japan",
  },
  "JDirectItems Auction": {
    color: "#d43b31", tint: "#fff1ef", home: "https://zenmarket.jp/en/",
    search: (query) => `https://zenmarket.jp/en/yahoo.aspx?q=${encodeURIComponent(query)}&p=1`,
    feeSummary: "ZenMarket source; proxy and international landed costs estimated",
    sourcingOnly: true, proxy: "ZenMarket", origin: "Japan",
  },
  Rakuten: {
    color: "#bf0000", tint: "#fff0f0", home: "https://zenmarket.jp/en/",
    search: (query) => `https://zenmarket.jp/en/rakuten.aspx?q=${encodeURIComponent(query)}&p=1`,
    feeSummary: "Rakuten through ZenMarket; proxy and landed costs estimated",
    sourcingOnly: true, proxy: "ZenMarket", origin: "Japan",
  },
  "Rakuten Rakuma": {
    color: "#59b75c", tint: "#effaf0", home: "https://zenmarket.jp/en/",
    search: (query) => `https://zenmarket.jp/en/rakuma.aspx?q=${encodeURIComponent(query)}&p=1`,
    feeSummary: "Rakuma through ZenMarket; proxy and landed costs estimated",
    sourcingOnly: true, proxy: "ZenMarket", origin: "Japan",
  },
  Bunjang: {
    color: "#ff4f3d", tint: "#fff2f0", home: "https://globalbunjang.com/",
    search: (query) => `https://globalbunjang.com/search?q=${encodeURIComponent(query)}`,
    feeSummary: "South Korea source; international landed costs estimated",
    sourcingOnly: true, origin: "South Korea",
  },
  Goofish: {
    color: "#f5c400", tint: "#fff9df", home: "https://www.goofish.com/",
    search: (query) => {
      const params = new URLSearchParams({
        nTag: "Home-search",
        from: "search-input",
        keyword: query,
        platform: "xy",
      });
      return `https://www.superbuy.com/en/page/search/?${params.toString()}`;
    },
    feeSummary: "Goofish/Xianyu results with a Superbuy buying-agent handoff; proxy, shipping, FX, and customs estimated",
    sourcingOnly: true, proxy: "Superbuy", origin: "China",
  },
};

export function money(value: number) {
  if (!Number.isFinite(value)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 20 ? 2 : 0,
  }).format(value);
}

export function median(values: number[]) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2
    ? valid[middle]
    : (valid[middle - 1] + valid[middle]) / 2;
}

export function feeForSale(
  marketplace: Marketplace,
  salePrice: number,
): FeeBreakdown {
  const price = Math.max(0, salePrice);
  if (MARKETPLACE_INFO[marketplace].sourcingOnly) {
    return { marketplaceFee: 0, processingFee: 0, fixedFee: 0, note: "Source-only marketplace; choose Depop, Grailed, or Poshmark as the resale target" };
  }

  if (marketplace === "Depop") {
    return {
      marketplaceFee: 0,
      processingFee: price * 0.033,
      fixedFee: 0.45,
      note: "US seller preset; boosting is not included",
    };
  }

  if (marketplace === "Grailed") {
    const marketplaceFee =
      price < 120 ? Math.max(1.99, price * 0.06) : price * 0.09;
    return {
      marketplaceFee,
      processingFee: price * 0.0349,
      fixedFee: 0.49,
      note: "Processing is an editable planning estimate because the actual rate can vary",
    };
  }

  return {
    marketplaceFee: price < 15 ? 2.95 : price * 0.2,
    processingFee: 0,
    fixedFee: 0,
    note: "US seller preset; optional shipping discounts are not included",
  };
}

function targetResult(
  listing: Listing,
  target: Marketplace,
  reserve: number,
  outboundShipping: number,
) {
  const prices = (listing.compPrices[target] ?? []).filter((price) => price > 0);
  const expectedSale = prices.length ? median(prices) : 0;
  const fees = expectedSale > 0
    ? feeForSale(target, expectedSale)
    : { marketplaceFee: 0, processingFee: 0, fixedFee: 0, note: "No sold or comparable price evidence is loaded" };
  const platformFees =
    fees.marketplaceFee + fees.processingFee + fees.fixedFee;
  const landedCost = listing.price + listing.shipping;
  const netProfit =
    expectedSale -
    platformFees -
    outboundShipping -
    reserve -
    landedCost;

  return {
    target,
    expectedSale,
    fees,
    platformFees,
    landedCost,
    netProfit,
    roi: landedCost > 0 ? (netProfit / landedCost) * 100 : 0,
    margin: expectedSale > 0 ? (netProfit / expectedSale) * 100 : 0,
    compCount: prices.length,
  };
}

export function analyzeListing(
  listing: Listing,
  target: TargetMarketplace = "Auto",
  reserve = 5,
  outboundShipping = 8.5,
): Opportunity {
  const candidates =
    target === "Auto"
      ? RESALE_MARKETPLACES.map((marketplace) =>
          targetResult(listing, marketplace, reserve, outboundShipping),
        )
      : [targetResult(listing, target, reserve, outboundShipping)];
  const best = candidates.sort((a, b) => b.netProfit - a.netProfit)[0];
  if (!best.compCount || best.expectedSale <= 0) {
    return {
      targetMarketplace: best.target,
      expectedSale: 0,
      platformFees: 0,
      outboundShipping,
      reserve,
      landedCost: best.landedCost,
      netProfit: -(best.landedCost + outboundShipping + reserve),
      roi: best.landedCost > 0
        ? (-(best.landedCost + outboundShipping + reserve) / best.landedCost) * 100
        : 0,
      margin: 0,
      score: 0,
      confidence: 0,
      compCount: 0,
      verdict: "Pass",
      fees: best.fees,
    };
  }
  const evidenceScore = Math.min(100, best.compCount * 18);
  const sellerScore = Math.min(
    100,
    listing.sellerRating * 14 + Math.log10(listing.sellerSales + 1) * 15,
  );
  const engagementScore = listing.engagement?.popularityScore ??
    (listing.likes > 0 ? Math.min(72, 18 + Math.log1p(listing.likes) * 13) : 0);
  const engagementEvidence = listing.engagement ? listing.engagement.confidence : listing.likes > 0 ? 42 : 0;
  const riskPenalty = listing.riskSignals.length * 7;
  const confidenceBase = listing.engagement
    ? evidenceScore * 0.50 + sellerScore * 0.30 + engagementEvidence * 0.20
    : evidenceScore * 0.58 + sellerScore * 0.42;
  const confidence = Math.round(
    Math.max(18, Math.min(98, confidenceBase - riskPenalty)),
  );
  const popularityAdjustment = listing.engagement
    ? Math.max(-3, Math.min(9, (engagementScore - 32) * 0.14))
    : listing.likes > 0 ? Math.min(5, Math.log1p(listing.likes) * 0.9) : 0;
  const score = Math.round(
    Math.max(
      1,
      Math.min(
        99,
        45 +
          best.roi * 0.32 +
          best.margin * 0.32 +
          confidence * 0.17 +
          popularityAdjustment -
          listing.riskSignals.length * 5 -
          Math.max(0, listing.ageDays - 14) * 0.25,
      ),
    ),
  );
  const verdict =
    score >= 82 && best.netProfit >= 30
      ? "Strong buy"
      : score >= 64 && best.netProfit > 10
        ? "Worth a look"
        : "Pass";

  return {
    targetMarketplace: best.target,
    expectedSale: best.expectedSale,
    platformFees: best.platformFees,
    outboundShipping,
    reserve,
    landedCost: best.landedCost,
    netProfit: best.netProfit,
    roi: best.roi,
    margin: best.margin,
    score,
    confidence,
    compCount: best.compCount,
    verdict,
    fees: best.fees,
  };
}

export function inferMarketplace(url: string): Marketplace | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "depop.com" || host.endsWith(".depop.com")) return "Depop";
    if (host === "grailed.com" || host.endsWith(".grailed.com")) return "Grailed";
    if (host === "poshmark.com" || host.endsWith(".poshmark.com"))
      return "Poshmark";
    if (host === "jp.mercari.com") return "Mercari Japan";
    if (host.endsWith("zenmarket.jp")) return "Rakuten";
    if (host.endsWith("globalbunjang.com")) return "Bunjang";
    if (host.endsWith("superbuy.com")) return "Goofish";
  } catch {
    return null;
  }
  return null;
}

export function emptyCompMap(): CompMap {
  return Object.fromEntries(MARKETPLACES.map((marketplace) => [marketplace, []])) as CompMap;
}
