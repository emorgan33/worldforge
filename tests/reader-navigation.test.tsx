import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readerArticleHref, readerWorldHref, searchReaderArticles } from "../src/lib/category-tree";
import { ReaderBreadcrumbs } from "../src/components/public/ReaderBreadcrumbs";
import { ReaderCategoryTree } from "../src/components/public/ReaderCategoryTree";
import { ReaderMobileBrowse } from "../src/components/public/ReaderMobileBrowse";
import { ReaderSearch } from "../src/components/public/ReaderSearch";
import { ReaderImageCredits, ReaderAdjacentCredit } from "../src/components/public/ReaderImageCredits";
import { Sidebar } from "../src/components/Sidebar";
import { WorldContentsExplorer } from "../src/components/WorldContentsExplorer";
import type { ArticleListItem } from "../src/types";

const publicArticles = [
  { id: "art-1", slug: "gate-of-dawn", title: "Gate of Dawn", template: "LANDMARK", excerpt: "An ancient portal carved in white stone.", categoryId: "cat-places" },
  { id: "art-2", slug: "dawn-knights", title: "Dawn Knights", template: "ORGANIZATION", excerpt: "Guardians sworn to the gate.", categoryId: "cat-orgs" },
  { id: "art-3", slug: "high-priest", title: "High Priest of the Sun", template: "CHARACTER", excerpt: "Leader of the Dawn Knights.", categoryId: "cat-orgs" },
  { id: "art-4", slug: "wandering-bard", title: "Wandering Bard", template: "CHARACTER", excerpt: null, categoryId: null },
];

const publicCategories = [
  { id: "cat-places", name: "Places", parentId: null, order: 0 },
  { id: "cat-orgs", name: "Factions & Guilds", parentId: null, order: 1 },
  { id: "cat-sub", name: "Secret Covens", parentId: "cat-orgs", order: 0 },
];

test("searchReaderArticles matches titles and excerpts and prioritizes title prefix matches", () => {
  // Empty query returns empty array
  assert.deepEqual(searchReaderArticles("", publicArticles), []);
  assert.deepEqual(searchReaderArticles("   ", publicArticles), []);

  // Title prefix match ranks first
  const dawnMatches = searchReaderArticles("Dawn", publicArticles);
  assert.equal(dawnMatches.length, 3);
  assert.equal(dawnMatches[0].id, "art-2"); // Dawn Knights (id is art-2) starts with Dawn
  assert(dawnMatches.some(a => a.id === "art-1")); // Gate of Dawn
  assert(dawnMatches.some(a => a.id === "art-3")); // matches excerpt "Dawn Knights"


  // Excerpt-only match
  const portalMatches = searchReaderArticles("portal", publicArticles);
  assert.deepEqual(portalMatches.map(a => a.id), ["art-1"]);

  // Multiple words match both words in title or excerpt
  const priestMatches = searchReaderArticles("priest sun", publicArticles);
  assert.deepEqual(priestMatches.map(a => a.id), ["art-3"]);

  // Non-matching query returns empty
  assert.deepEqual(searchReaderArticles("dragon", publicArticles), []);
});

test("ReaderBreadcrumbs renders navigable list with accessible aria-label", () => {
  const crumbs = [
    { label: "Elmsworth", href: "/w/elmsworth" },
    { label: "Factions & Guilds" },
    { label: "Dawn Knights" },
  ];
  const html = renderToStaticMarkup(<ReaderBreadcrumbs items={crumbs} />);

  assert(html.includes('aria-label="Breadcrumb"'));
  assert(html.includes('href="/w/elmsworth"'));
  assert(html.includes("Elmsworth"));
  assert(html.includes("Factions &amp; Guilds"));
  assert(html.includes("Dawn Knights"));
  assert(html.includes('aria-current="page"'));

  // Empty items render nothing
  assert.equal(renderToStaticMarkup(<ReaderBreadcrumbs items={[]} />), "");
});

test("ReaderCategoryTree renders nested hierarchy and root articles", () => {
  const html = renderToStaticMarkup(
    <ReaderCategoryTree
      categories={publicCategories}
      articles={publicArticles}
      worldSlug="elmsworth"
      currentArticleId="art-2"
    />
  );

  assert(html.includes('aria-label="World contents"'));
  assert(html.includes("Places"));
  assert(html.includes("Factions &amp; Guilds"));
  assert(html.includes("Gate of Dawn"));
  assert(html.includes("Dawn Knights"));
  assert(html.includes("Wandering Bard"));
  assert(html.includes('href="/w/elmsworth/a/gate-of-dawn"'));
  assert(html.includes('href="/w/elmsworth/a/dawn-knights"'));
  assert(html.includes('href="/w/elmsworth/a/wandering-bard"'));
  assert(html.includes('href="/w/elmsworth"'));
  assert(html.includes("World home"));
  assert(html.includes("Articles"));
  // Active article has aria-current="page"
  assert(html.includes('aria-current="page"'));
});

test("ReaderCategoryTree renders category illustrations with a folder fallback", () => {
  const categoriesWithArt = [
    { id: "cat-places", name: "Places", parentId: null, order: 0, iconImage: "/api/assets/11111111-1111-4111-8111-111111111111/file" },
    { id: "cat-orgs", name: "Factions & Guilds", parentId: null, order: 1, iconImage: null },
  ];
  const html = renderToStaticMarkup(
    <ReaderCategoryTree categories={categoriesWithArt} articles={publicArticles} worldSlug="elmsworth" />,
  );

  // The authorized illustration renders as an image with no leaking alt text.
  assert(html.includes('src="/api/assets/11111111-1111-4111-8111-111111111111/file"'));
  assert(html.includes('alt=""'));
  // A category without a readable image keeps its labelled folder fallback.
  assert(html.includes("Factions &amp; Guilds"));
});

test("ReaderImageCredits lists deduped credits and ReaderAdjacentCredit shows only adjacent art", () => {
  const credits = [
    { assetId: "11111111-1111-4111-8111-111111111111", title: "Ship by Moonlight", creditText: "Ivan Aivazovsky, Ship by Moonlight, CC0 1.0", placement: "adjacent" as const, verificationOrigin: "BUNDLED_REVIEW" as const },
    { assetId: "22222222-2222-4222-8222-222222222222", title: "Forest Brook", creditText: "Ivan Shishkin, Forest Brook, CC0 1.0", placement: "credits-section" as const, verificationOrigin: "BUNDLED_REVIEW" as const },
  ];
  const html = renderToStaticMarkup(
    <>
      <ReaderImageCredits credits={credits} />
      <ReaderAdjacentCredit credits={credits} assetId="11111111-1111-4111-8111-111111111111" />
      <ReaderAdjacentCredit credits={credits} assetId="22222222-2222-4222-8222-222222222222" />
    </>,
  );

  assert(html.includes('aria-label="Artwork credits"'));
  assert(html.includes("Ivan Aivazovsky, Ship by Moonlight, CC0 1.0"));
  assert(html.includes("Ivan Shishkin, Forest Brook, CC0 1.0"));
  assert(!html.includes("22222222-2222-4222-8222-222222222222</p>"));
  // Exactly one adjacent caption: the credits-section artwork must not appear inline.
  assert.equal((html.match(/Ivan Aivazovsky/g) || []).length, 2);
  assert.equal((html.match(/Ivan Shishkin/g) || []).length, 1);
});

test("ReaderImageCredits renders nothing without credits", () => {
  const html = renderToStaticMarkup(<ReaderImageCredits credits={[]} />);
  assert.equal(html, "");
});

test("campaign reader tree uses campaign links and marks the home location", () => {  const html = renderToStaticMarkup(
    <ReaderCategoryTree
      categories={publicCategories}
      articles={publicArticles}
      worldSlug="elmsworth"
      readerType="campaign"
      currentPage="home"
    />
  );

  assert(html.includes('href="/c/elmsworth" aria-current="page"'));
  assert(html.includes('href="/c/elmsworth/a/gate-of-dawn"'));
  assert(html.includes('href="/c/elmsworth/a/dawn-knights"'));
  assert(!html.includes('href="/w/elmsworth'));
});

test("mobile browse disclosure exposes campaign navigation without duplicate section IDs", () => {
  const html = renderToStaticMarkup(
    <>
      <ReaderMobileBrowse
        categories={publicCategories}
        articles={publicArticles}
        worldSlug="elmsworth"
        currentArticleId="art-2"
        readerType="campaign"
      />
      <ReaderCategoryTree
        categories={publicCategories}
        articles={publicArticles}
        worldSlug="elmsworth"
        currentArticleId="art-2"
        readerType="campaign"
      />
    </>
  );
  const articleHeadingIds = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);

  assert(html.includes("<details"));
  assert(html.includes("<summary"));
  assert(html.includes("Browse articles"));
  assert(html.includes('href="/c/elmsworth/a/dawn-knights"'));
  assert(articleHeadingIds.length >= 2);
  assert.equal(new Set(articleHeadingIds).size, articleHeadingIds.length);
});

test("mobile author rail keeps destinations separate from World contents", () => {
  const html = renderToStaticMarkup(
    <Sidebar
      worldTitle="Elmsworth"
      system="DND_5E"
      activeView="article"
      onNavigateView={() => {}}
      mobile
    />
  );

  assert(html.includes('aria-label="World menu"'));
  assert(html.includes('aria-label="Campaign navigation" class="shrink-0 border-b'));
  assert(html.includes("grid grid-cols-2 gap-x-2 gap-y-1"));
  for (const destination of ["Home", "Articles", "Maps", "Timelines", "Sessions", "Compendium", "DM tools"]) {
    assert(html.includes(`aria-label="${destination}"`));
  }
  assert(html.includes('aria-label="Articles" aria-current="page"'));
  assert.equal(html.includes("World contents"), false, "the tree now lives in the separate explorer");
  assert(html.includes(">More tools</summary>"), "utilities remain in the rail");
});

test("World contents explorer shows empty worlds and actionable organization errors", () => {
  const html = renderToStaticMarkup(
    <WorldContentsExplorer
      articles={[]}
      categories={[]}
      onSelectArticle={() => {}}
      onSelectCategory={() => {}}
      onMove={async () => {}}
      organizationBusy={false}
      organizationError="Could not move that article."
      pinned
      onTogglePin={() => {}}
      onClose={() => {}}
    />
  );

  assert(html.includes('role="alert"'));
  assert(html.includes("Could not move that article."));
  assert(html.includes("Create a category or article to organize your lore."));
  assert(html.includes('aria-label="Unpin world contents"'));
  assert(html.includes('aria-pressed="true"'));
});

test("World contents explorer exposes pin, collapse and accessible selection", () => {
  const html = renderToStaticMarkup(
    <WorldContentsExplorer
      articles={[{ id: "a", worldId: "world", slug: "a", title: "The beacon", template: "GENERIC", state: "DRAFT", isPinned: false, order: 0, createdAt: "", updatedAt: "", wordCount: 0 } as ArticleListItem]}
      categories={[{ id: "cat", worldId: "world", name: "Places", parentId: null, order: 0 }]}
      selectedArticleId="a"
      selectedCategoryId="cat"
      onSelectArticle={() => {}}
      onSelectCategory={() => {}}
      onMove={async () => {}}
      organizationBusy={false}
      organizationError=""
      pinned={false}
      onTogglePin={() => {}}
      onClose={() => {}}
      drawer
    />
  );

  assert(html.includes('aria-label="World contents" role="dialog" aria-modal="true"'));
  assert(html.includes('aria-label="Pin world contents"'));
  assert(html.includes('aria-label="Close world contents"'));
  assert(html.includes('aria-label="Collapse Places"'));
  assert(html.includes('aria-current="page"'), "the selected article is identifiable to assistive technology");
  assert(html.includes("1 article"));
});

test("ReaderSearch renders accessible input and search controls", () => {
  const html = renderToStaticMarkup(<ReaderSearch worldSlug="elmsworth" articles={publicArticles} />);
  assert(html.includes('aria-label="Search public articles"'));
  assert(html.includes('type="search"'));
  assert(html.includes('placeholder="Search public articles…"'));
  assert.equal(readerArticleHref("elmsworth", "gate-of-dawn"), "/w/elmsworth/a/gate-of-dawn");

  const campaignHtml = renderToStaticMarkup(<ReaderSearch worldSlug="elmsworth" articles={publicArticles} readerType="campaign" />);
  assert(campaignHtml.includes('aria-label="Search articles"'));
  assert(campaignHtml.includes('placeholder="Search articles…"'));
  assert.equal(readerArticleHref("elmsworth", "gate-of-dawn", "campaign"), "/c/elmsworth/a/gate-of-dawn");
  assert.equal(readerWorldHref("elmsworth", "campaign"), "/c/elmsworth");
});
