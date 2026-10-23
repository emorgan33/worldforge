import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readerArticleHref, readerWorldHref, searchReaderArticles } from "../src/lib/category-tree";
import { ReaderBreadcrumbs } from "../src/components/public/ReaderBreadcrumbs";
import { ReaderCategoryTree } from "../src/components/public/ReaderCategoryTree";
import { ReaderMobileBrowse } from "../src/components/public/ReaderMobileBrowse";
import { ReaderSearch } from "../src/components/public/ReaderSearch";
import { Sidebar } from "../src/components/Sidebar";

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

test("campaign reader tree uses campaign links and marks the home location", () => {
  const html = renderToStaticMarkup(
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

test("mobile author navigation gives World contents the remaining drawer space", () => {
  const html = renderToStaticMarkup(
    <Sidebar
      onOpenSearch={() => {}}
      worldTitle="Elmsworth"
      system="DND_5E"
      articles={[]}
      categories={[{ id: "cat", worldId: "world", name: "Places", parentId: null, order: 0 }]}
      selectedCategoryId={null}
      onSelectCategory={() => {}}
      onMove={async () => {}}
      organizationBusy={false}
      organizationError=""
      activeView="home"
      selectedArticleId={null}
      onSelectArticle={() => {}}
      onNavigateView={() => {}}
      onNewArticle={() => {}}
      mobile
    />
  );

  assert(html.includes('aria-label="World menu"'));
  assert(html.includes('aria-label="Campaign navigation" class="shrink-0 border-b'));
  assert(html.includes("grid grid-cols-2 gap-x-2 gap-y-1"));
  for (const destination of ["Home", "Articles", "Maps", "Timelines", "Sessions", "Compendium", "DM tools"]) {
    assert(html.includes(`aria-label="${destination}"`));
  }
  assert(html.includes('aria-label="World contents" class="sidebar-lore-scroll min-h-0 flex-1 border-b'));
  assert(html.includes("flex flex-col overflow-hidden"));
  assert(html.includes("overflow-x-hidden overflow-y-auto min-h-0 flex-1"));
  assert(html.includes('aria-label="Collapse Places"'));
  assert(html.includes("flex h-11 w-11 shrink-0 items-center justify-center"));
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
