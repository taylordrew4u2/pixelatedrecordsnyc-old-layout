import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import nextConfig from "../next.config";
import robots from "../src/app/robots";
import { generateMetadata } from "../src/app/[[...slug]]/page";
import { metadata as adminMetadata } from "../src/app/admin/page";
import { legacySeedContent, seedContent } from "../src/lib/seed";
import {
  applyEditorialDefaults,
  businessStructuredData,
  eventStructuredData,
  previousPageSeo,
  defaultPageSeo,
  serializeStructuredData,
} from "../src/lib/site-seo";

test("portfolio pages and all responses remain excluded from search without blocking public crawling", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "pixelated-portfolio-seo-"),
  );
  const names = [
    "CONTENT_STORAGE",
    "PIXELATED_DATA_DIR",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERCEL",
    "NETLIFY",
    "SITE_ID",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) delete process.env[name];
  process.env.CONTENT_STORAGE = "local";
  process.env.PIXELATED_DATA_DIR = directory;
  try {
    for (const page of seedContent.pages) {
      const metadata = await generateMetadata({
        params: Promise.resolve({
          slug: page.id === "home" ? undefined : [page.id],
        }),
        searchParams: Promise.resolve({}),
      });
      assert.deepEqual(
        metadata.robots,
        { index: false, follow: true },
        page.id,
      );
      assert.ok(metadata.title, `${page.id} keeps its sharing title`);
    }
    const headers = await nextConfig.headers!();
    const publicRule = headers.find((rule) => rule.source === "/:path*");
    assert.ok(
      publicRule?.headers.some(
        (header) =>
          header.key.toLowerCase() === "x-robots-tag" &&
          header.value === "noindex",
      ),
    );
    const crawlerRules = robots().rules;
    assert.ok(crawlerRules && !Array.isArray(crawlerRules));
    assert.equal(crawlerRules.allow, "/");
    assert.ok(
      Array.isArray(crawlerRules.disallow) &&
        !crawlerRules.disallow.includes("/"),
    );
    assert.deepEqual(adminMetadata.robots, { index: false, follow: false });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy published defaults gain local SEO without changing custom editor copy or uploads", () => {
  const content = structuredClone(legacySeedContent);
  content.pages[0].seoTitle = "Pixelated Records | Record Shop, Bar & Events";
  const bar = content.pages.find((page) => page.id === "bar")!;
  bar.seoTitle = "Taylor’s custom bar title";
  bar.seoDescription = "Owner-written description";
  bar.title = "Owner title";
  bar.eyebrow = "Owner eyebrow";
  bar.description = "Owner page copy";
  bar.imageAlt = "Owner photo description";
  bar.shareImage = "/api/media/custom-upload";
  content.bar.menuNotice = "Ask about our seasonal menu.";
  const updated = applyEditorialDefaults(content, legacySeedContent);
  assert.equal(
    updated.pages[0].seoTitle,
    "Pixelated Records | Record Store & Bar in Ridgewood, Queens",
  );
  assert.equal(updated.pages[0].shareImage, "/assets/storefront-wide-day.webp");
  assert.deepEqual(
    updated.pages.find((page) => page.id === "bar"),
    bar,
  );
  assert.equal(updated.bar.menuNotice, content.bar.menuNotice);
  assert.equal(
    content.pages[0].shareImage,
    "/assets/storefront.webp",
    "does not mutate stored content",
  );
  assert.deepEqual(
    applyEditorialDefaults(updated, legacySeedContent),
    updated,
    "migration is idempotent",
  );
});

test("business schema uses the published address and enhanced photo, without unconfirmed details", () => {
  const data = businessStructuredData(seedContent, "https://example.com");
  assert.equal(data["@id"], "https://example.com/#business");
  assert.equal(data.image, "https://example.com/assets/storefront-wide-day.webp");
  assert.deepEqual(data.address, {
    "@type": "PostalAddress",
    streetAddress: "792 Onderdonk Avenue",
    addressLocality: "Ridgewood",
    addressRegion: "NY",
    postalCode: "11385",
    addressCountry: "US",
  });
  assert.ok(!("openingHoursSpecification" in data));
  // Coordinates and map come from the venue's verified Google Maps place.
  assert.deepEqual(data.geo, {
    "@type": "GeoCoordinates",
    latitude: 40.7023993,
    longitude: -73.9048206,
  });
  assert.match(data.hasMap, /place_id:ChIJp90R_w9dwokRE0mMtzH1X0M/);
  assert.ok(!("telephone" in data));
  assert.equal(data.sameAs.length, 1);
});

test("saved first-version metadata and launch copy are upgraded, while custom copy is preserved", () => {
  const content = structuredClone(legacySeedContent);
  const oldSeo = previousPageSeo(content);
  for (const page of content.pages) {
    const old = oldSeo[page.id as keyof typeof oldSeo];
    page.seoTitle = old.title;
    page.seoDescription = old.description;
  }
  const updated = applyEditorialDefaults(content, legacySeedContent);
  const bar = updated.pages.find((page) => page.id === "bar")!;
  assert.match(bar.description, /zero-proof drinks/);
  assert.equal(bar.seoTitle, defaultPageSeo(content).bar.title);
  assert.match(
    updated.pages.find((page) => page.id === "events")!.description,
    /DJ nights/,
  );
  assert.deepEqual(applyEditorialDefaults(updated, legacySeedContent), updated);
  content.bar.categories = [];
  assert.equal(
    applyEditorialDefaults(content, legacySeedContent).bar.categories.length,
    0,
    "cleared menus stay cleared",
  );
});

test("event schema describes only published dated events and keeps cancelled events accurate", () => {
  const event = {
    id: "test",
    title: "Test DJ night",
    slug: "test-dj-night",
    description: "An event description",
    image: "/assets/booth.webp",
    imageAlt: "DJ booth",
    start: "2026-11-19T21:00:00-05:00",
    end: "2026-11-20T01:00:00-05:00",
    doors: "",
    url: "",
    price: "",
    status: "scheduled" as const,
    published: true,
    featured: false,
  };
  const data = eventStructuredData(event, seedContent, "https://example.com")!;
  assert.equal(data.url, "https://example.com/events/test-dj-night");
  assert.equal(data.startDate, event.start);
  assert.equal(data.endDate, event.end);
  assert.equal(data.location.name, "Pixelated Records");
  assert.ok(!("offers" in data));
  assert.equal(
    eventStructuredData(
      { ...event, published: false },
      seedContent,
      "https://example.com",
    ),
    null,
  );
  assert.equal(
    eventStructuredData(
      { ...event, start: "" },
      seedContent,
      "https://example.com",
    ),
    null,
  );
  assert.equal(
    eventStructuredData(
      { ...event, status: "cancelled" },
      seedContent,
      "https://example.com",
    )!.eventStatus,
    "https://schema.org/EventCancelled",
  );
});

test("only confirmed complete opening hours enter the business schema", () => {
  const content = structuredClone(seedContent);
  content.location.hours = [
    { day: 5, closed: false, open: "17:00", close: "02:00", note: "" },
    { day: 1, closed: true, open: "", close: "", note: "" },
    { day: 2, closed: false, open: "", close: "", note: "" },
  ];
  assert.ok(
    !(
      "openingHoursSpecification" in
      businessStructuredData(content, "https://example.com")
    ),
  );
  content.location.hoursConfirmed = true;
  const data = businessStructuredData(content, "https://example.com");
  assert.equal(data.openingHoursSpecification?.length, 2);
  assert.equal(
    data.openingHoursSpecification?.[0].dayOfWeek,
    "https://schema.org/Friday",
  );
  assert.equal(data.openingHoursSpecification?.[0].closes, "02:00");
});

test("editable text cannot break out of a structured-data script", () => {
  const value = { name: "</script><script>alert(1)</script>" };
  const serialized = serializeStructuredData(value);
  assert.ok(!serialized.includes("<"));
  assert.deepEqual(JSON.parse(serialized), value);
});
