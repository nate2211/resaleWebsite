import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const engagementUrl = new URL("../app/lib/engagement.ts", import.meta.url).href;

test("extracts all public metrics from embedded and visible marketplace states", () => {
  const script = String.raw`
    import { extractMarketplaceEngagement } from ${JSON.stringify(engagementUrl)};

    const poshState = {
      $_listing_details: {
        listingDetails: {
          like_count: 18,
          share_count: 240,
          comment_count: 4,
          active_buyer_offer_count: 2,
          first_published_at: "2026-07-09T12:00:00Z",
          active_item: true,
          inventory: { status: "available", size_quantities: [] },
        },
        listingMetrics: { metrics: { likes: 18, views: 516, clicks: 71, buyer_offers: 2 } },
        listerData: {
          username: "fixture-seller",
          aggregates: {
            followers: 95,
            seller_orders: 33,
            seller_rating_count: 10,
            seller_rating_value: 49,
            last_active_date: "2026-07-26",
          },
        },
      },
    };
    const poshHtml = '<script>window.__INITIAL_STATE__ = ' + JSON.stringify(poshState) + ';<\\/script>';

    const grailedData = {
      props: { pageProps: { listing: {
        followerCount: 12,
        viewCount: 420,
        clickCount: 39,
        commentCount: 5,
        offerCount: 3,
        shareCount: 8,
        trueCreatedAt: "2026-07-20T10:00:00Z",
        sold: false,
        dropped: false,
        seller: {
          username: "fixture-grailed",
          followerCount: 55,
          sellerScore: { soldCount: 20, ratingAverage: 4.9, ratingCount: 15 },
          isVerified: true,
          isTrustedSeller: true,
        },
      } } },
    };
    const grailedHtml = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(grailedData) + '<\\/script>';

    const flight = JSON.stringify(JSON.stringify({
      like_count: 14,
      view_count: 300,
      click_count: 28,
      comment_count: 3,
      offer_count: 2,
      share_count: 7,
      created_at: "2026-07-18T09:00:00Z",
      is_boosted: true,
      status: "ACTIVE",
    }));
    const depopHtml = '<script>self.__next_f.push([1,' + flight + '])<\\/script>' +
      '<p>24 sold</p><p>Active today</p>';


    const reports = {
      Poshmark: extractMarketplaceEngagement(poshHtml, "https://poshmark.com/listing/fixture", "Poshmark"),
      Grailed: extractMarketplaceEngagement(grailedHtml, "https://www.grailed.com/listings/1-fixture", "Grailed"),
      Depop: extractMarketplaceEngagement(depopHtml, "https://www.depop.com/products/fixture/", "Depop"),
    };
    console.log(JSON.stringify(reports));
  `;
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    script,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const reports = JSON.parse(result.stdout.trim());

  assert.deepEqual(reports.Poshmark.metrics, {
    likes: 18, views: 516, clicks: 71, shares: 240, comments: 4, offers: 2,
  });
  assert.equal(reports.Poshmark.seller.rating, 4.9);
  assert.equal(reports.Poshmark.completeness, 100);

  assert.deepEqual(reports.Grailed.metrics, {
    likes: 12, views: 420, clicks: 39, shares: 8, comments: 5, offers: 3,
  });
  assert.ok(reports.Grailed.ageDays >= 0);

  assert.deepEqual(reports.Depop.metrics, {
    likes: 14, views: 300, clicks: 28, shares: 7, comments: 3, offers: 2,
  });
  assert.equal(reports.Depop.boosted, true);
  assert.equal(reports.Depop.seller.itemsSold, 24);

});
