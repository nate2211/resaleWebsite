export const APPAREL_TYPES = [
  "T-Shirts",
  "Long Sleeve T-Shirts",
  "Sweatshirts",
  "Hoodies",
  "Sweaters & Knitwear",
  "Shirts & Button-Ups",
  "Polos",
  "Tank Tops",
  "Jackets & Coats",
  "Jeans",
  "Pants",
  "Shorts",
  "Dresses & Skirts",
  "Shoes",
  "Bags",
  "Accessories",
] as const;

export type ApparelType = (typeof APPAREL_TYPES)[number];
export type ApparelFilter = ApparelType | "All clothing";

const APPAREL_PATTERNS: { type: ApparelType; pattern: RegExp }[] = [
  { type: "Hoodies", pattern: /\b(?:hoodie|hooded sweatshirt|hooded top|pullover hood|zip[- ]?up hood)\b/i },
  { type: "Sweatshirts", pattern: /\b(?:sweatshirt|sweat shirt|crewneck|crew neck|quarter[- ]?zip|half[- ]?zip)\b/i },
  { type: "Long Sleeve T-Shirts", pattern: /\b(?:long[- ]?sleeve(?:d)?(?: t[- ]?shirt| tee)?|l\/s tee|ls tee)\b/i },
  { type: "T-Shirts", pattern: /\b(?:t[- ]?shirt|tee|tee shirt|graphic tee|boxy tee|short[- ]?sleeve tee)\b/i },
  { type: "Sweaters & Knitwear", pattern: /\b(?:sweater|knitwear|knit|cardigan|jumper|mohair|pullover)\b/i },
  { type: "Polos", pattern: /\b(?:polo(?: shirt)?|rugby shirt)\b/i },
  { type: "Tank Tops", pattern: /\b(?:tank top|sleeveless top|singlet|vest top)\b/i },
  { type: "Shirts & Button-Ups", pattern: /\b(?:button[- ]?up|button[- ]?down|dress shirt|overshirt|flannel|camp collar|short[- ]?sleeve shirt|long[- ]?sleeve shirt|shirt)\b/i },
  { type: "Jackets & Coats", pattern: /\b(?:jacket|coat|parka|anorak|windbreaker|bomber|blazer|puffer|trucker jacket|varsity jacket|shell jacket)\b/i },
  { type: "Jeans", pattern: /\b(?:jeans?|denim pants?|denim trousers?)\b/i },
  { type: "Shorts", pattern: /\b(?:shorts?|swim trunks?|boardshorts?)\b/i },
  { type: "Pants", pattern: /\b(?:pants?|trousers?|cargo pants?|chinos?|sweatpants?|joggers?)\b/i },
  { type: "Dresses & Skirts", pattern: /\b(?:dress|skirt|gown|mini dress|midi dress|maxi dress)\b/i },
  { type: "Shoes", pattern: /\b(?:shoes?|sneakers?|boots?|loafers?|sandals?|slides?|trainers?)\b/i },
  { type: "Bags", pattern: /\b(?:bag|backpack|tote|duffle|duffel|messenger|crossbody|shoulder bag|waist bag|pouch)\b/i },
  { type: "Accessories", pattern: /\b(?:hat|cap|beanie|belt|wallet|scarf|gloves?|sunglasses|jewelry|necklace|bracelet|ring|watch|accessor(?:y|ies))\b/i },
];

export function inferApparelType(...values: unknown[]): ApparelType | undefined {
  const haystack = values
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ")
    .replace(/[_/]+/g, " ");
  if (!haystack) return undefined;
  return APPAREL_PATTERNS.find(({ pattern }) => pattern.test(haystack))?.type;
}

export function apparelSearchTerm(filter: ApparelFilter | string) {
  return filter === "All" || filter === "All clothing" ? "" : filter.trim();
}
