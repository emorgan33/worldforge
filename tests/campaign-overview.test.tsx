import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignOverview } from "@/components/campaign/CampaignOverview";

const callbacks = {
  onNewArticle: () => undefined,
  onSelectArticle: () => undefined,
  onOpenCompendium: () => undefined,
  onOpenGm: () => undefined,
  onRefreshSessions: () => undefined,
};

test("campaign home shows the active rules as context and leads with creation and sessions", () => {
  const html = renderToStaticMarkup(<CampaignOverview
    system="PF_2E"
    worldTitle="The Long World Title That Should Wrap Instead of Being Ellipsized"
    articles={[]}
    blocks={[]}
    sessions={[]}
    worldId="world-1"
    {...callbacks}
  />);

  assert.match(html, /The Long World Title That Should Wrap Instead of Being Ellipsized/);
  assert.match(html, /PF2e · Remaster/);
  assert.match(html, /Create for your world/);
  assert.match(html, /Next Session/);
  assert.match(html, /Create first session/);
  assert.match(html, /Create first article/);
  assert.match(html, /Edit world &amp; styling/);
  assert.doesNotMatch(html, /Change rules|Choose.*Dungeons &amp; Dragons|Choose.*Pathfinder/);
  assert.ok(html.indexOf("Create for your world") < html.indexOf("Compendium"));
});

test("campaign home keeps real article links and compendium counts available", () => {
  const html = renderToStaticMarkup(<CampaignOverview
    system="DND_5E"
    worldTitle="Aethelgard"
    articles={[
      { id: "article-2", worldId: "world-1", template: "GENERIC", title: "Second", slug: "second", state: "DRAFT", isPinned: false, order: 2, wordCount: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "article-1", worldId: "world-1", template: "GENERIC", title: "First", slug: "first", state: "DRAFT", isPinned: false, order: 1, wordCount: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    ]}
    blocks={[]}
    sessions={[]}
    worldId="world-1"
    {...callbacks}
  />);

  assert.ok(html.indexOf("First") < html.indexOf("Second"));
  assert.match(html, /World content/);
  assert.match(html, /Bestiary/);
  assert.match(html, /Spellbook/);
  assert.match(html, /Treasure/);
});

test("campaign article list starts compact and exposes the expansion action for longer lists", () => {
  const articles = Array.from({ length: 6 }, (_, index) => ({
    id: `article-${index + 1}`,
    worldId: "world-1",
    template: "GENERIC" as const,
    title: `Article ${index + 1}`,
    slug: `article-${index + 1}`,
    state: "DRAFT" as const,
    isPinned: false,
    order: index + 1,
    wordCount: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  }));
  const html = renderToStaticMarkup(<CampaignOverview
    system="DND_5E"
    worldTitle="Aethelgard"
    articles={articles}
    blocks={[]}
    {...callbacks}
  />);

  assert.match(html, /Article 1/);
  assert.match(html, /Article 5/);
  assert.doesNotMatch(html, /Article 6/);
  assert.match(html, /Browse all articles \(6\)/);
});
