import { feeForSale, type Opportunity } from "./analysis";
import type { AuthenticityReport, AuthenticityVerdict } from "./authenticity";
import type { DemandLevel, EngagementReport } from "./engagement";

export type ModelListingReview = {
  listingId: string;
  queryFit: number;
  scoreDelta: number;
  confidenceDelta: number;
  resaleMultiplier: number;
  engagementDelta: number;
  authenticityDelta: number;
  note: string;
};

export type ModelEngagementAssessment = {
  scoreDelta: number;
  confidenceDelta: number;
  adjustedScore: number;
  adjustedConfidence: number;
  demandLevel: DemandLevel;
  summary: string;
  drivers: string[];
};

export type ModelAuthenticityAssessment = {
  scoreDelta: number;
  confidenceDelta: number;
  adjustedConfidence: number;
  verdict: AuthenticityVerdict;
  summary: string;
  reasons: string[];
};

export type ModelCandidateReview = {
  listingId: string;
  scoreDelta: number;
  note: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function demandLevelForScore(score: number, known = true): DemandLevel {
  if (!known) return "unknown";
  if (score >= 78) return "very-high";
  if (score >= 58) return "high";
  if (score >= 34) return "moderate";
  return "low";
}

export function mergeModelListingReview(
  base: ModelListingReview | undefined,
  engagement?: ModelEngagementAssessment,
  authenticity?: ModelAuthenticityAssessment,
): ModelListingReview | undefined {
  if (!base && !engagement && !authenticity) return undefined;
  const engagementContribution = engagement ? clamp(engagement.scoreDelta * 0.45, -6, 6) : 0;
  const authenticityContribution = authenticity ? clamp(authenticity.scoreDelta * 0.7, -10, 5) : 0;
  const confidenceContribution = (engagement?.confidenceDelta ?? 0) * 0.35 +
    (authenticity?.confidenceDelta ?? 0) * 0.55;
  return {
    listingId: base?.listingId ?? "",
    queryFit: base?.queryFit ?? 50,
    scoreDelta: clamp((base?.scoreDelta ?? 0) + engagementContribution + authenticityContribution, -24, 20),
    confidenceDelta: clamp((base?.confidenceDelta ?? 0) + confidenceContribution, -18, 14),
    resaleMultiplier: clamp(base?.resaleMultiplier ?? 1, 0.9, 1.08),
    engagementDelta: clamp((base?.engagementDelta ?? 0) + (engagement?.scoreDelta ?? 0), -16, 16),
    authenticityDelta: clamp((base?.authenticityDelta ?? 0) + (authenticity?.scoreDelta ?? 0), -18, 10),
    note: [base?.note, engagement?.summary, authenticity?.summary].filter(Boolean).join(" ").slice(0, 420),
  };
}

export function applyModelListingReview(
  opportunity: Opportunity,
  review?: ModelListingReview,
): Opportunity {
  if (!review) return opportunity;
  const resaleMultiplier = clamp(review.resaleMultiplier, 0.9, 1.08);
  const expectedSale = opportunity.expectedSale * resaleMultiplier;
  const fees = feeForSale(opportunity.targetMarketplace, expectedSale);
  const platformFees = fees.marketplaceFee + fees.processingFee + fees.fixedFee;
  const netProfit = expectedSale - platformFees - opportunity.outboundShipping -
    opportunity.reserve - opportunity.landedCost;
  const roi = opportunity.landedCost > 0 ? netProfit / opportunity.landedCost * 100 : 0;
  const margin = expectedSale > 0 ? netProfit / expectedSale * 100 : 0;
  const score = Math.round(clamp(opportunity.score + clamp(review.scoreDelta, -24, 20), 1, 99));
  const confidence = Math.round(clamp(
    opportunity.confidence + clamp(review.confidenceDelta, -18, 14),
    5,
    99,
  ));
  const verdict = score >= 82 && netProfit >= 30
    ? "Strong buy"
    : score >= 64 && netProfit > 10
      ? "Worth a look"
      : "Pass";
  return {
    ...opportunity,
    expectedSale,
    platformFees,
    netProfit,
    roi,
    margin,
    score,
    confidence,
    verdict,
    fees,
  };
}

export function finalizeEngagementAssessment(
  report: EngagementReport,
  input: Partial<Pick<ModelEngagementAssessment, "scoreDelta" | "confidenceDelta" | "summary" | "drivers">>,
): ModelEngagementAssessment {
  let scoreDelta = clamp(Number(input.scoreDelta) || 0, -12, 12);
  let confidenceDelta = clamp(Number(input.confidenceDelta) || 0, -12, 10);
  if (report.completeness < 25) scoreDelta = Math.min(scoreDelta, 3);
  if (report.boosted) scoreDelta = Math.min(scoreDelta, 3);
  if (report.demandLevel === "unknown") scoreDelta = Math.min(scoreDelta, 2);
  const adjustedScore = Math.round(clamp(report.popularityScore + scoreDelta, 0, 100));
  const adjustedConfidence = Math.round(clamp(report.confidence + confidenceDelta, 15, 98));
  const known = report.demandLevel !== "unknown" || report.sold === true;
  return {
    scoreDelta,
    confidenceDelta,
    adjustedScore,
    adjustedConfidence,
    demandLevel: demandLevelForScore(adjustedScore, known),
    summary: (input.summary || "The local model kept the deterministic engagement estimate unchanged.").slice(0, 520),
    drivers: [...new Set(input.drivers ?? [])].slice(0, 5),
  };
}

export function finalizeAuthenticityAssessment(
  report: AuthenticityReport,
  input: Partial<Pick<ModelAuthenticityAssessment, "scoreDelta" | "confidenceDelta" | "summary" | "reasons">>,
): ModelAuthenticityAssessment {
  let scoreDelta = clamp(Number(input.scoreDelta) || 0, -14, 6);
  let confidenceDelta = clamp(Number(input.confidenceDelta) || 0, -16, 8);
  const warnings = report.checks.filter((check) => check.status === "warning").length;
  const matches = report.checks.filter((check) => check.status === "match").length;
  const closeReferences = report.references.filter((reference) => reference.similarity >= 0.58).length;

  // The model may make the result more cautious freely, but can only upgrade an
  // inconclusive report when the deterministic evidence is already unusually strong.
  if (report.verdict === "high-risk") {
    scoreDelta = Math.min(scoreDelta, 0);
    confidenceDelta = Math.min(confidenceDelta, 4);
  }
  if (warnings >= 2) scoreDelta = Math.min(scoreDelta, 0);
  if (closeReferences === 0) scoreDelta = Math.min(scoreDelta, 0);

  const adjustedConfidence = Math.round(clamp(report.confidence + confidenceDelta, 5, 96));
  let verdict: AuthenticityVerdict = report.verdict;
  if (report.verdict === "reference-consistent" && scoreDelta <= -7) verdict = "inconclusive";
  if (
    report.verdict === "inconclusive" && scoreDelta >= 4 && warnings === 0 &&
    matches >= 2 && closeReferences >= 2
  ) {
    verdict = "reference-consistent";
  }
  return {
    scoreDelta,
    confidenceDelta,
    adjustedConfidence,
    verdict,
    summary: (input.summary || "The local model kept the sourced authenticity result unchanged.").slice(0, 620),
    reasons: [...new Set(input.reasons ?? [])].slice(0, 6),
  };
}
