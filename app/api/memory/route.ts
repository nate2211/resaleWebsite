type MemoryEvent = {
  id: string;
  type: string;
  createdAt: string;
  query?: string;
  prompt?: string;
  view?: string;
  marketplace?: string;
  listingId?: string;
  title?: string;
  brand?: string;
  url?: string;
  payload?: Record<string, unknown>;
};

type MemoryStore = typeof globalThis & {
  __flipScopeMemory?: MemoryEvent[];
};

const store = globalThis as MemoryStore;
const fallbackMemory = store.__flipScopeMemory ?? [];
store.__flipScopeMemory = fallbackMemory;

function safeText(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : undefined;
}

function normalize(input: Record<string, unknown>): MemoryEvent {
  return {
    id: safeText(input.id, 100) || crypto.randomUUID(),
    type: safeText(input.type, 50) || "interaction",
    createdAt: safeText(input.createdAt, 40) || new Date().toISOString(),
    query: safeText(input.query, 180),
    prompt: safeText(input.prompt, 2000),
    view: safeText(input.view, 50),
    marketplace: safeText(input.marketplace, 30),
    listingId: safeText(input.listingId, 220),
    title: safeText(input.title, 300),
    brand: safeText(input.brand, 100),
    url: safeText(input.url, 1000),
    payload:
      input.payload && typeof input.payload === "object"
        ? (input.payload as Record<string, unknown>)
        : undefined,
  };
}

function summarize(events: MemoryEvent[]) {
  const counts: Record<string, number> = {};
  const brandAffinity: Record<string, number> = {};
  const queryHistory: string[] = [];
  for (const event of events) {
    counts[event.type] = (counts[event.type] || 0) + 1;
    if (event.brand && ["favorite", "listing_click", "source_click"].includes(event.type)) {
      brandAffinity[event.brand] = (brandAffinity[event.brand] || 0) +
        (event.type === "favorite" ? 4 : 1);
    }
    if (event.query && !queryHistory.includes(event.query)) queryHistory.push(event.query);
  }
  return {
    eventCount: events.length,
    counts,
    brandAffinity,
    recentQueries: queryHistory.slice(-20).reverse(),
    recentEvents: events.slice(-80).reverse(),
  };
}

export async function GET() {
  return Response.json(summarize(fallbackMemory));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const event = normalize(body);
  if (!fallbackMemory.some((stored) => stored.id === event.id)) fallbackMemory.push(event);
  if (fallbackMemory.length > 1000) fallbackMemory.splice(0, fallbackMemory.length - 1000);
  return Response.json({ event }, { status: 201 });
}

export async function DELETE() {
  fallbackMemory.splice(0);
  return Response.json({ cleared: true });
}
