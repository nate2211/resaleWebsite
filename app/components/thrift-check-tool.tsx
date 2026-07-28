"use client";

/* Marketplace image hosts are dynamic and intentionally remain normal images. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import {
  feeForSale,
  median,
  money,
  type Listing,
  type Marketplace,
} from "../lib/analysis";
import { searchMarketplaceFrontend } from "../lib/frontend-marketplaces";
import {
  analyzeImageFile,
  analyzeImageBlob,
  compareImageMetrics,
  fetchImageForMath,
  type ImageMathMetrics,
} from "../lib/image-metrics";
import {
  captionBrowserImages,
  generateBrowserText,
  loadBrowserAiSuite,
} from "../lib/browser-ai";

type AiState = "idle" | "loading" | "ready" | "error";

type SimilarComp = {
  listing: Partial<Listing>;
  similarity: number;
};

type ThriftResult = {
  query: string;
  expectedSale: number;
  lowSale: number;
  highSale: number;
  target: "Depop" | "Grailed" | "Poshmark";
  fees: number;
  netProfit: number | null;
  roi: number | null;
  verdict: "Buy" | "Consider" | "Pass" | "Price needed";
  confidence: number;
  compCount: number;
  soldCount: number;
  activeCount: number;
  aiSummary: string;
  evidence: Partial<Listing>[];
  similarComps: SimilarComp[];
  metrics: ImageMathMetrics[];
  captions: string[];
};

function percentile(values: number[], fraction: number) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const position = (valid.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return valid[lower];
  return valid[lower] + (valid[upper] - valid[lower]) * (position - lower);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function weightedMean(items: Array<{ value: number; weight: number }>) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight ? items.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight : 0;
}

function priceOf(listing: Partial<Listing>) {
  const value = Number(listing.price || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function bestTarget(expectedSale: number, purchasePrice: number, outboundShipping: number, reserve: number) {
  const targets = ["Depop", "Grailed", "Poshmark"] as const;
  return targets.map((target) => {
    const fee = feeForSale(target, expectedSale);
    const fees = fee.marketplaceFee + fee.processingFee + fee.fixedFee;
    const net = expectedSale - fees - outboundShipping - reserve - purchasePrice;
    return { target, fees, net };
  }).sort((a, b) => b.net - a.net)[0];
}

function verdictFor(netProfit: number | null, roi: number | null) {
  if (netProfit === null || roi === null) return "Price needed" as const;
  if (netProfit >= 30 && roi >= 55) return "Buy" as const;
  if (netProfit >= 12 && roi >= 25) return "Consider" as const;
  return "Pass" as const;
}

export function ThriftCheckTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [itemName, setItemName] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState("Good used condition");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [outboundShipping, setOutboundShipping] = useState("8.50");
  const [reserve, setReserve] = useState("5");
  const [computerVision, setComputerVision] = useState(true);
  const [soldImageMath, setSoldImageMath] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiProgress, setAiProgress] = useState("AI is optional for Thrift Check.");
  const [state, setState] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Upload at least one photo and describe the item.");
  const [result, setResult] = useState<ThriftResult | null>(null);

  useEffect(() => {
    const next = files.map((file) => URL.createObjectURL(file));
    setPreviews(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const parsedPurchasePrice = Number.parseFloat(purchasePrice);
  const canAnalyze = files.length > 0 && Boolean(itemName.trim() || brand.trim() || (useAi && aiState === "ready"));
  const qualityAverage = useMemo(() => result ? average(result.metrics.map((metric) => metric.qualityScore)) : 0, [result]);

  async function loadAi() {
    if (aiState === "loading" || aiState === "ready") return;
    setAiState("loading");
    setAiProgress("Loading local text and image models…");
    try {
      const suite = await loadBrowserAiSuite(setAiProgress);
      setAiState("ready");
      setUseAi(true);
      setAiProgress(`Local AI ready with ${suite.device.toUpperCase()}. Images remain in your browser.`);
    } catch {
      setAiState("error");
      setAiProgress("The local AI models could not load. Thrift Check can still run with sold-price analysis.");
    }
  }

  async function runAnalysis() {
    if (!files.length) {
      setState("error");
      setMessage("Add at least one item photo.");
      return;
    }
    if (useAi && aiState !== "ready") {
      setState("error");
      setMessage("Load the optional AI models first, or turn off AI assistance.");
      return;
    }
    if (!itemName.trim() && !brand.trim() && !useAi) {
      setState("error");
      setMessage("Describe the shirt or enter its brand so sold searches have a usable query.");
      return;
    }

    setState("working");
    setMessage("Reading images and searching marketplace evidence…");
    setResult(null);
    try {
      const metricSettled = computerVision
        ? await Promise.allSettled(files.slice(0, 6).map((file) => analyzeImageFile(file)))
        : [];
      const metrics = metricSettled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
      const captions = useAi ? await captionBrowserImages(files, 4) : [];
      const captionQuery = captions.find((caption) => !/unavailable/i.test(caption)) || "";
      const query = [brand.trim(), itemName.trim() || captionQuery, size.trim()].filter(Boolean).join(" ").trim();
      if (!query) throw new Error("The images did not produce a searchable description. Add a short item description.");

      const searches = await Promise.allSettled([
        searchMarketplaceFrontend({ marketplace: "Grailed", query, mode: "sold" }),
        searchMarketplaceFrontend({ marketplace: "Depop", query, mode: "active" }),
        searchMarketplaceFrontend({ marketplace: "Poshmark", query, mode: "active" }),
      ]);
      const successful = searches.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
      const soldListings = successful.find((entry) => entry.marketplace === "Grailed")?.listings
        .filter((listing) => priceOf(listing) > 0) || [];
      const activeListings = successful.filter((entry) => entry.marketplace !== "Grailed")
        .flatMap((entry) => entry.listings).filter((listing) => priceOf(listing) > 0);
      const allEvidence = [...soldListings, ...activeListings].slice(0, 30);
      const soldPrices = soldListings.map(priceOf);
      const activeAdjusted = activeListings.map((listing) => priceOf(listing) * 0.84);
      const evidencePrices = soldPrices.length >= 3 ? soldPrices : [...soldPrices, ...activeAdjusted];
      if (!evidencePrices.length) {
        throw new Error("No readable sold or active prices were returned. Try a more specific brand and item description.");
      }

      const similarComps: SimilarComp[] = [];
      if (computerVision && soldImageMath && metrics[0]) {
        const candidates = soldListings.filter((listing) => Boolean(listing.image)).slice(0, 6);
        const comparisonSettled = await Promise.allSettled(candidates.map(async (listing) => {
          const blob = await fetchImageForMath(String(listing.image));
          const compMetric = await analyzeImageBlob(blob, String(listing.title || "sold comparison"));
          return { listing, similarity: compareImageMetrics(metrics[0], compMetric) };
        }));
        similarComps.push(...comparisonSettled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []));
        similarComps.sort((a, b) => b.similarity - a.similarity);
      }

      const similarityEstimate = similarComps.length
        ? weightedMean(similarComps.map((comp) => ({ value: priceOf(comp.listing), weight: 0.25 + comp.similarity ** 2 })))
        : 0;
      const baseMedian = median(evidencePrices);
      const expectedSale = similarityEstimate > 0
        ? baseMedian * 0.55 + similarityEstimate * 0.45
        : baseMedian;
      const lowSale = percentile(evidencePrices, 0.25);
      const highSale = percentile(evidencePrices, 0.75);
      const purchase = Number.isFinite(parsedPurchasePrice) && parsedPurchasePrice >= 0 ? parsedPurchasePrice : null;
      const shipping = Math.max(0, Number.parseFloat(outboundShipping) || 0);
      const riskReserve = Math.max(0, Number.parseFloat(reserve) || 0);
      const targetMath = bestTarget(expectedSale, purchase ?? 0, shipping, riskReserve);
      const netProfit = purchase === null ? null : targetMath.net;
      const roi = purchase === null || purchase <= 0 ? null : targetMath.net / purchase * 100;
      const compConfidence = Math.min(78, soldListings.length * 12 + activeListings.length * 4);
      const imageConfidence = metrics.length ? Math.min(12, average(metrics.map((metric) => metric.qualityScore)) * 0.12) : 0;
      const similarityConfidence = similarComps.length ? average(similarComps.slice(0, 3).map((comp) => comp.similarity)) * 10 : 0;
      const confidence = Math.round(Math.min(96, 20 + compConfidence + imageConfidence + similarityConfidence));
      const verdict = verdictFor(netProfit, roi);

      let aiSummary = "AI assistance was not used. The recommendation is based on marketplace prices, selling fees, and optional image math.";
      if (useAi) {
        aiSummary = await generateBrowserText(
          `You are a cautious thrift-store apparel sourcing assistant. Never certify authenticity and never replace the deterministic math.\n` +
          `ITEM: ${query}; condition: ${condition}; purchase price: ${purchase === null ? "not entered" : `$${purchase.toFixed(2)}`}.\n` +
          `IMAGE CAPTIONS: ${captions.join(" | ") || "none"}.\n` +
          `IMAGE METRICS: ${metrics.map((metric) => `${metric.dominantColor}, quality ${metric.qualityScore}, edge ${metric.edgeDensity.toFixed(2)}, sharpness ${metric.sharpness.toFixed(2)}`).join(" | ") || "not enabled"}.\n` +
          `MARKET MATH: expected resale $${expectedSale.toFixed(2)}, range $${lowSale.toFixed(2)}-$${highSale.toFixed(2)}, sold comps ${soldListings.length}, active comps ${activeListings.length}, target ${targetMath.target}, net ${netProfit === null ? "unknown" : `$${netProfit.toFixed(2)}`}, ROI ${roi === null ? "unknown" : `${roi.toFixed(1)}%`}, verdict ${verdict}, confidence ${confidence}.\n` +
          `Write 3 concise sentences: what appears visible, why the math supports or rejects buying, and exactly what to inspect in person.`,
          { maxNewTokens: 170 },
        );
      }

      setResult({
        query,
        expectedSale,
        lowSale,
        highSale,
        target: targetMath.target,
        fees: targetMath.fees,
        netProfit,
        roi,
        verdict,
        confidence,
        compCount: evidencePrices.length,
        soldCount: soldListings.length,
        activeCount: activeListings.length,
        aiSummary,
        evidence: allEvidence,
        similarComps: similarComps.slice(0, 6),
        metrics,
        captions,
      });
      setState("ready");
      setMessage(`Analyzed ${evidencePrices.length} readable price points for “${query}”.`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Thrift Check could not complete.");
    }
  }

  return (
    <div className="tool-workspace">
      <section className="tool-panel upload-panel">
        <div className="tool-panel-heading">
          <div><span className="panel-kicker">1 · Photograph the find</span><h2>Item photos and details</h2></div>
          <span className="privacy-chip">Local image processing</span>
        </div>
        <label className="image-dropzone">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 8))}
          />
          <strong>Take photos or upload item images</strong>
          <span>Front, back, neck tag, care label, graphics, and flaws improve the analysis.</span>
        </label>
        {previews.length > 0 && (
          <div className="upload-preview-grid">
            {previews.map((url, index) => <img key={url} src={url} alt={`Thrift item upload ${index + 1}`} />)}
          </div>
        )}
        <div className="tool-form-grid">
          <label><span>Brand</span><input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Supreme, Nike, vintage, unknown…" /></label>
          <label><span>Item description</span><input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Box logo hoodie, graphic tee, denim jacket…" /></label>
          <label><span>Size</span><input value={size} onChange={(event) => setSize(event.target.value)} placeholder="M, 42, one size…" /></label>
          <label><span>Condition</span><select value={condition} onChange={(event) => setCondition(event.target.value)}><option>New with tags</option><option>Excellent used condition</option><option>Good used condition</option><option>Fair with visible wear</option><option>Needs repair or cleaning</option></select></label>
          <label><span>Thrift price (optional)</span><input inputMode="decimal" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} placeholder="12.99" /></label>
          <label><span>Outbound shipping</span><input inputMode="decimal" value={outboundShipping} onChange={(event) => setOutboundShipping(event.target.value)} /></label>
          <label><span>Risk reserve</span><input inputMode="decimal" value={reserve} onChange={(event) => setReserve(event.target.value)} /></label>
        </div>
      </section>

      <section className="tool-panel advanced-panel">
        <div className="tool-panel-heading"><div><span className="panel-kicker">2 · Optional depth</span><h2>Advanced analysis</h2></div></div>
        <div className="toggle-list">
          <label><input type="checkbox" checked={computerVision} onChange={(event) => setComputerVision(event.target.checked)} /><span><strong>Computer-vision math</strong><small>Measures exposure, contrast, sharpness, edges, dominant color, resolution, and perceptual hashes.</small></span></label>
          <label><input type="checkbox" checked={soldImageMath} disabled={!computerVision} onChange={(event) => setSoldImageMath(event.target.checked)} /><span><strong>Compare with sold-item images</strong><small>Best-effort mathematical similarity against readable Grailed sold photos; unavailable images are skipped.</small></span></label>
          <label><input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} /><span><strong>Local AI explanation</strong><small>Captions uploaded images and explains the already-calculated evidence. It does not certify authenticity.</small></span></label>
        </div>
        <div className={`ai-load-row ${aiState}`}>
          <div><strong>{aiState === "ready" ? "Local AI ready" : "Optional local AI"}</strong><span>{aiProgress}</span></div>
          <button className="secondary-button" type="button" onClick={loadAi} disabled={aiState === "loading" || aiState === "ready"}>{aiState === "loading" ? "Loading…" : aiState === "ready" ? "Loaded" : "Load AI models"}</button>
        </div>
        <button className="primary-button tool-run-button" type="button" onClick={runAnalysis} disabled={!canAnalyze || state === "working"}>{state === "working" ? "Checking sold evidence…" : "Run Thrift Check"}</button>
        <p className={`tool-status ${state}`} role="status">{message}</p>
      </section>

      {result && (
        <section className="tool-panel result-panel" aria-live="polite">
          <div className="result-verdict-row">
            <div><span className="panel-kicker">Recommendation</span><h2>{result.verdict}</h2><p>{result.aiSummary}</p></div>
            <div className={`verdict-badge ${result.verdict.toLowerCase().replace(" ", "-")}`}>{result.confidence}% confidence</div>
          </div>
          <div className="result-metric-grid">
            <article><span>Expected resale</span><strong>{money(result.expectedSale)}</strong><small>{money(result.lowSale)}–{money(result.highSale)} evidence range</small></article>
            <article><span>Best resale target</span><strong>{result.target}</strong><small>{money(result.fees)} estimated platform fees</small></article>
            <article><span>Estimated profit</span><strong>{result.netProfit === null ? "Enter thrift price" : money(result.netProfit)}</strong><small>{result.roi === null ? "ROI needs a purchase price" : `${result.roi.toFixed(1)}% ROI`}</small></article>
            <article><span>Comparable evidence</span><strong>{result.compCount}</strong><small>{result.soldCount} sold · {result.activeCount} active</small></article>
          </div>
          {result.metrics.length > 0 && (
            <div className="vision-summary">
              <h3>Uploaded-image metrics</h3>
              <div className="vision-metric-grid">
                {result.metrics.map((metric) => (
                  <article key={metric.name}><strong>{metric.name}</strong><span>{metric.dominantColor} · quality {metric.qualityScore}/100</span><small>{metric.megapixels.toFixed(1)} MP · brightness {(metric.brightness * 100).toFixed(0)}% · edges {(metric.edgeDensity * 100).toFixed(0)}% · sharpness {(metric.sharpness * 100).toFixed(0)}%</small></article>
                ))}
              </div>
              <p>Average image-evidence quality: <strong>{qualityAverage.toFixed(0)}/100</strong>. This measures photo readability, not garment quality or authenticity.</p>
            </div>
          )}
          {result.similarComps.length > 0 && (
            <div className="evidence-strip"><h3>Closest sold-image matches</h3><div className="evidence-card-grid">{result.similarComps.map(({ listing, similarity }) => <a key={String(listing.url)} href={String(listing.url)} target="_blank" rel="noreferrer"><img src={String(listing.image)} alt="" /><strong>{String(listing.title)}</strong><span>{money(priceOf(listing))} · {(similarity * 100).toFixed(0)}% visual similarity</span></a>)}</div></div>
          )}
          <div className="evidence-strip"><h3>Market evidence used</h3><div className="evidence-card-grid">{result.evidence.slice(0, 10).map((listing) => <a key={`${listing.marketplace}-${listing.url}`} href={String(listing.url)} target="_blank" rel="noreferrer">{listing.image ? <img src={String(listing.image)} alt="" /> : <div className="evidence-placeholder">No image</div>}<strong>{String(listing.title)}</strong><span>{String(listing.marketplace)} · {money(priceOf(listing))}</span></a>)}</div></div>
          <p className="tool-caveat">Planning estimate only. Inspect tags, measurements, stains, odors, repairs, fabric damage, and authenticity details in person before purchasing.</p>
        </section>
      )}
    </div>
  );
}
