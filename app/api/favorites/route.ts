type FavoriteRecord = {
  id: string;
  title: string;
  brand: string;
  marketplace: string;
  url: string;
  price: number;
  savedAt: string;
  [key: string]: unknown;
};

const store = globalThis as typeof globalThis & {
  __flipScopeFavorites?: Map<string, FavoriteRecord>;
};
const favorites = store.__flipScopeFavorites ?? new Map<string, FavoriteRecord>();
store.__flipScopeFavorites = favorites;

function response(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET() {
  return response({ favorites: [...favorites.values()] });
}

export async function POST(request: Request) {
  const value = await request.json().catch(() => ({})) as Partial<FavoriteRecord>;
  if (!value.id || !value.title || !value.marketplace || !value.url) {
    return response({ error: "Favorite listing details are incomplete." }, 400);
  }
  const favorite: FavoriteRecord = {
    ...value,
    id: String(value.id),
    title: String(value.title),
    brand: String(value.brand || "Unspecified"),
    marketplace: String(value.marketplace),
    url: String(value.url),
    price: Number(value.price) || 0,
    savedAt: new Date().toISOString(),
  };
  favorites.set(favorite.id, favorite);
  return response({ favorite }, 201);
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    favorites.clear();
    return response({ cleared: true });
  }
  favorites.delete(id);
  return response({ removed: id });
}
