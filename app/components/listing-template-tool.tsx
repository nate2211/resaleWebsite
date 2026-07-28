"use client";

/* Dynamic user-uploaded and marketplace image URLs intentionally use img. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { median, money, type Listing } from "../lib/analysis";
import { searchMarketplaceFrontend } from "../lib/frontend-marketplaces";
import { analyzeImageFile, type ImageMathMetrics } from "../lib/image-metrics";
import {
  captionBrowserImages,
  generateBrowserText,
  loadBrowserAiSuite,
} from "../lib/browser-ai";

type AiState = "idle" | "loading" | "ready" | "error";

type ListingDraft = {
  brand: string;
  title: string;
  category: string;
  condition: string;
  color: string;
  material: string;
  size: string;
  listPrice: string;
  floorPrice: string;
  description: string;
  tags: string;
};

const EMPTY_DRAFT: ListingDraft = {
  brand: "",
  title: "",
  category: "",
  condition: "",
  color: "",
  material: "",
  size: "",
  listPrice: "",
  floorPrice: "",
  description: "",
  tags: "",
};

function priceOf(listing: Partial<Listing>) {
  const value = Number(listing.price || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function fieldFrom(text: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
}

function multilineField(text: string, name: string, nextFields: string[]) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stop = nextFields.map((field) => field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.match(new RegExp(`^\\s*${escaped}\\s*:\\s*([\\s\\S]*?)(?=^\\s*(?:${stop})\\s*:|$)`, "im"))?.[1]?.trim() || "";
}

function numericMoney(value: string, fallback: number) {
  const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compactTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function ListingTemplateTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [brandHint, setBrandHint] = useState("");
  const [itemHint, setItemHint] = useState("");
  const [sizeHint, setSizeHint] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [platform, setPlatform] = useState("Depop");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiProgress, setAiProgress] = useState("Load the private local models to unlock this page.");
  const [state, setState] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [message, setMessage] = useState("The Listing Template generator requires the local AI models.");
  const [draft, setDraft] = useState<ListingDraft>(EMPTY_DRAFT);
  const [captions, setCaptions] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<ImageMathMetrics[]>([]);
  const [evidence, setEvidence] = useState<Partial<Listing>[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const next = files.map((file) => URL.createObjectURL(file));
    setPreviews(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const filledFields = useMemo(() => Object.values(draft).filter(Boolean).length, [draft]);

  async function loadAi() {
    if (aiState === "loading" || aiState === "ready") return;
    setAiState("loading");
    setAiProgress("Loading local image and writing models…");
    try {
      const suite = await loadBrowserAiSuite(setAiProgress);
      setAiState("ready");
      setAiProgress(`AI ready with ${suite.device.toUpperCase()}. The downloaded models are cached by your browser.`);
      setMessage("Upload item photos and generate a listing template.");
    } catch {
      setAiState("error");
      setAiProgress("The local models could not load. Check browser WebGPU/WASM support and network access to the model files.");
      setMessage("Listing Template cannot run until both local models load successfully.");
    }
  }

  async function generateTemplate() {
    if (aiState !== "ready") {
      setState("error");
      setMessage("Load the local AI models before generating a listing.");
      return;
    }
    if (!files.length) {
      setState("error");
      setMessage("Upload at least one clear item photo.");
      return;
    }
    setState("working");
    setMessage("Captioning images, checking market prices, and drafting the listing…");
    setDraft(EMPTY_DRAFT);
    setEvidence([]);
    try {
      const [imageCaptions, metricSettled] = await Promise.all([
        captionBrowserImages(files, 6),
        Promise.allSettled(files.slice(0, 6).map((file) => analyzeImageFile(file))),
      ]);
      const imageMetrics = metricSettled.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
      setCaptions(imageCaptions);
      setMetrics(imageMetrics);
      const primaryCaption = imageCaptions.find((caption) => !/unavailable/i.test(caption)) || "apparel item";
      const query = [brandHint.trim(), itemHint.trim() || primaryCaption, sizeHint.trim()].filter(Boolean).join(" ").trim();
      const searches = await Promise.allSettled([
        searchMarketplaceFrontend({ marketplace: "Grailed", query, mode: "sold" }),
        searchMarketplaceFrontend({ marketplace: "Depop", query, mode: "active" }),
        searchMarketplaceFrontend({ marketplace: "Poshmark", query, mode: "active" }),
      ]);
      const results = searches.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
      const sold = results.find((entry) => entry.marketplace === "Grailed")?.listings.filter((listing) => priceOf(listing) > 0) || [];
      const active = results.filter((entry) => entry.marketplace !== "Grailed").flatMap((entry) => entry.listings)
        .filter((listing) => priceOf(listing) > 0);
      const pricingEvidence = sold.length >= 3
        ? sold.map(priceOf)
        : [...sold.map(priceOf), ...active.map((listing) => priceOf(listing) * 0.86)];
      const marketMedian = pricingEvidence.length ? median(pricingEvidence) : 0;
      const deterministicListPrice = marketMedian > 0 ? Math.ceil(marketMedian * 1.08 / 5) * 5 : 0;
      const deterministicFloor = marketMedian > 0 ? Math.max(5, Math.floor(marketMedian * 0.78 / 5) * 5) : 0;
      setEvidence([...sold, ...active].slice(0, 12));

      const metricSummary = imageMetrics.map((metric) =>
        `${metric.dominantColor}; quality ${metric.qualityScore}/100; brightness ${(metric.brightness * 100).toFixed(0)}%; ` +
        `sharpness ${(metric.sharpness * 100).toFixed(0)}%; ${metric.width}x${metric.height}`,
      ).join(" | ");
      const evidenceSummary = [...sold, ...active].slice(0, 12).map((listing) =>
        `${listing.marketplace}: ${listing.title}; $${priceOf(listing).toFixed(2)}; ${listing.condition || "condition unknown"}`,
      ).join("\n");
      const output = await generateBrowserText(
        `Create a cautious resale listing template from image captions, user notes, and marketplace evidence. ` +
        `Do not claim authenticity, exact fabric, exact age, or condition details that are not visible or supplied. ` +
        `Use the deterministic market price as the pricing anchor, not your own guess. Keep the title under 80 characters.\n` +
        `TARGET PLATFORM: ${platform}\nBRAND HINT: ${brandHint || "none"}\nITEM HINT: ${itemHint || "none"}\nSIZE HINT: ${sizeHint || "none"}\n` +
        `CONDITION NOTES: ${conditionNotes || "none"}\nIMAGE CAPTIONS: ${imageCaptions.join(" | ")}\nIMAGE MATH: ${metricSummary || "unavailable"}\n` +
        `MARKET EVIDENCE: sold ${sold.length}, active ${active.length}, median ${marketMedian ? `$${marketMedian.toFixed(2)}` : "unavailable"}, ` +
        `recommended list ${deterministicListPrice ? `$${deterministicListPrice}` : "unavailable"}, floor ${deterministicFloor ? `$${deterministicFloor}` : "unavailable"}.\n` +
        `${evidenceSummary || "No readable marketplace cards."}\n` +
        `Return exactly these labeled fields:\nBRAND:\nTITLE:\nCATEGORY:\nCONDITION:\nCOLOR:\nMATERIAL:\nSIZE:\nLIST_PRICE:\nFLOOR_PRICE:\nDESCRIPTION:\nTAGS:`,
        { maxNewTokens: 420 },
      );

      const modelListPrice = numericMoney(fieldFrom(output, "LIST_PRICE"), deterministicListPrice);
      const modelFloor = numericMoney(fieldFrom(output, "FLOOR_PRICE"), deterministicFloor || modelListPrice * 0.75);
      const nextDraft: ListingDraft = {
        brand: fieldFrom(output, "BRAND") || brandHint || "Unbranded",
        title: compactTitle(fieldFrom(output, "TITLE") || [brandHint, itemHint || primaryCaption, sizeHint].filter(Boolean).join(" ")),
        category: fieldFrom(output, "CATEGORY") || "Apparel",
        condition: fieldFrom(output, "CONDITION") || conditionNotes || "Pre-owned; inspect photos and disclose all visible wear",
        color: fieldFrom(output, "COLOR") || imageMetrics[0]?.dominantColor || "See photos",
        material: fieldFrom(output, "MATERIAL") || "Check care label",
        size: fieldFrom(output, "SIZE") || sizeHint || "See measurements",
        listPrice: modelListPrice > 0 ? modelListPrice.toFixed(0) : "",
        floorPrice: modelFloor > 0 ? Math.min(modelFloor, modelListPrice || modelFloor).toFixed(0) : "",
        description: multilineField(output, "DESCRIPTION", ["TAGS"]) ||
          `${primaryCaption}. ${conditionNotes || "Review all photos for condition."} Measurements and material should be confirmed before publishing.`,
        tags: fieldFrom(output, "TAGS") || [brandHint, itemHint, platform, imageMetrics[0]?.dominantColor].filter(Boolean).join(", "),
      };
      setDraft(nextDraft);
      setState("ready");
      setMessage(`Generated ${Object.values(nextDraft).filter(Boolean).length} editable fields using ${pricingEvidence.length} market price points.`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "The listing template could not be generated.");
    }
  }

  function update<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function copyTemplate() {
    const text = [
      draft.title,
      "",
      draft.description,
      "",
      `Brand: ${draft.brand}`,
      `Category: ${draft.category}`,
      `Condition: ${draft.condition}`,
      `Color: ${draft.color}`,
      `Material: ${draft.material}`,
      `Size: ${draft.size}`,
      `List price: ${draft.listPrice ? `$${draft.listPrice}` : "Not set"}`,
      `Floor price: ${draft.floorPrice ? `$${draft.floorPrice}` : "Not set"}`,
      `Tags: ${draft.tags}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="tool-workspace listing-template-workspace">
      <section className="tool-panel upload-panel">
        <div className="tool-panel-heading">
          <div><span className="panel-kicker">1 · Load private AI</span><h2>Local model requirement</h2></div>
          <span className={`ai-required-chip ${aiState}`}>{aiState === "ready" ? "AI ready" : "AI required"}</span>
        </div>
        <p className="tool-explainer">This page intentionally stays locked until both the browser image-caption model and writing model are loaded. The models run locally after downloading; generated details remain editable and must be verified.</p>
        <div className={`ai-load-row ${aiState}`}>
          <div><strong>{aiState === "ready" ? "Models loaded" : "Load image + writing models"}</strong><span>{aiProgress}</span></div>
          <button className="primary-button" type="button" onClick={loadAi} disabled={aiState === "loading" || aiState === "ready"}>{aiState === "loading" ? "Loading models…" : aiState === "ready" ? "Ready" : "Load AI"}</button>
        </div>
      </section>

      <section className={`tool-panel upload-panel ${aiState !== "ready" ? "locked-panel" : ""}`} aria-disabled={aiState !== "ready"}>
        <div className="tool-panel-heading"><div><span className="panel-kicker">2 · Add the item</span><h2>Photos and known facts</h2></div></div>
        <label className="image-dropzone">
          <input disabled={aiState !== "ready"} type="file" accept="image/*" capture="environment" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 8))} />
          <strong>Take photos or upload listing images</strong>
          <span>Include front, back, tags, details, measurements, and every flaw you plan to disclose.</span>
        </label>
        {previews.length > 0 && <div className="upload-preview-grid">{previews.map((url, index) => <img key={url} src={url} alt={`Listing upload ${index + 1}`} />)}</div>}
        <div className="tool-form-grid">
          <label><span>Brand hint</span><input disabled={aiState !== "ready"} value={brandHint} onChange={(event) => setBrandHint(event.target.value)} placeholder="Supreme, Levi's, unknown…" /></label>
          <label><span>Item hint</span><input disabled={aiState !== "ready"} value={itemHint} onChange={(event) => setItemHint(event.target.value)} placeholder="Graphic tee, hoodie, denim…" /></label>
          <label><span>Size hint</span><input disabled={aiState !== "ready"} value={sizeHint} onChange={(event) => setSizeHint(event.target.value)} placeholder="M, 32, OS…" /></label>
          <label><span>Target platform</span><select disabled={aiState !== "ready"} value={platform} onChange={(event) => setPlatform(event.target.value)}><option>Depop</option><option>Grailed</option><option>Poshmark</option><option>eBay</option><option>Mercari US</option></select></label>
          <label className="form-span-2"><span>Condition notes and flaws</span><textarea disabled={aiState !== "ready"} value={conditionNotes} onChange={(event) => setConditionNotes(event.target.value)} placeholder="Small mark near hem, light fading, no holes, measurements…" rows={4} /></label>
        </div>
        <button className="primary-button tool-run-button" type="button" disabled={aiState !== "ready" || !files.length || state === "working"} onClick={generateTemplate}>{state === "working" ? "Generating and pricing…" : "Generate Listing Template"}</button>
        <p className={`tool-status ${state}`} role="status">{message}</p>
      </section>

      {state === "ready" && (
        <section className="tool-panel result-panel listing-draft-panel">
          <div className="tool-panel-heading">
            <div><span className="panel-kicker">3 · Verify and publish</span><h2>Editable listing draft</h2><p>{filledFields} fields generated. Confirm every claim before posting.</p></div>
            <button className="secondary-button" type="button" onClick={copyTemplate}>{copied ? "Copied" : "Copy template"}</button>
          </div>
          <div className="listing-draft-grid">
            <label className="form-span-2"><span>Title</span><input value={draft.title} onChange={(event) => update("title", event.target.value)} maxLength={80} /><small>{draft.title.length}/80 characters</small></label>
            <label><span>Brand</span><input value={draft.brand} onChange={(event) => update("brand", event.target.value)} /></label>
            <label><span>Category</span><input value={draft.category} onChange={(event) => update("category", event.target.value)} /></label>
            <label><span>Condition</span><input value={draft.condition} onChange={(event) => update("condition", event.target.value)} /></label>
            <label><span>Color</span><input value={draft.color} onChange={(event) => update("color", event.target.value)} /></label>
            <label><span>Material</span><input value={draft.material} onChange={(event) => update("material", event.target.value)} /></label>
            <label><span>Size</span><input value={draft.size} onChange={(event) => update("size", event.target.value)} /></label>
            <label><span>List price</span><input inputMode="decimal" value={draft.listPrice} onChange={(event) => update("listPrice", event.target.value)} /></label>
            <label><span>Floor price</span><input inputMode="decimal" value={draft.floorPrice} onChange={(event) => update("floorPrice", event.target.value)} /></label>
            <label className="form-span-2"><span>Description</span><textarea rows={9} value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
            <label className="form-span-2"><span>Tags</span><textarea rows={3} value={draft.tags} onChange={(event) => update("tags", event.target.value)} /></label>
          </div>
          {metrics.length > 0 && <div className="vision-summary"><h3>Image evidence used by the generator</h3><p>{metrics.map((metric) => `${metric.dominantColor} (${metric.qualityScore}/100 photo quality)`).join(" · ")}</p><p>Captions: {captions.join(" | ")}</p></div>}
          {evidence.length > 0 && <div className="evidence-strip"><h3>Pricing evidence</h3><div className="evidence-card-grid">{evidence.map((listing) => <a key={`${listing.marketplace}-${listing.url}`} href={String(listing.url)} target="_blank" rel="noreferrer">{listing.image ? <img src={String(listing.image)} alt="" /> : <div className="evidence-placeholder">No image</div>}<strong>{String(listing.title)}</strong><span>{String(listing.marketplace)} · {money(priceOf(listing))}</span></a>)}</div></div>}
          <p className="tool-caveat">The model can misread an image. Verify brand, fabric, measurements, color, condition, authenticity, and pricing against the physical item and original marketplace evidence.</p>
        </section>
      )}
    </div>
  );
}
