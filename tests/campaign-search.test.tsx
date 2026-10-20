import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandSearch } from "../src/components/CommandSearch";
import {
  articleSearchWhere,
  campaignSearchUrl,
  filterLocalCommands,
  paginateSearch,
  parseCampaignSearchParams,
  presentSearchArticle,
  rankSearchArticles,
  SEARCH_PAGE_SIZE,
  SearchInputError,
} from "../src/lib/campaign-search";

const articles = [
  { id: "a1", title: "Dawn Knights", excerpt: "Guardians", tags: "", template: "ORGANIZATION", publicationStatus: "PUBLISHED", categoryId: "orgs" },
  { id: "a2", title: "Gate of Dawn", excerpt: "An ancient portal", tags: "landmark", template: "LANDMARK", publicationStatus: "DRAFT", categoryId: "places" },
  { id: "a3", title: "High Priest", excerpt: "Leader of the Dawn Knights", tags: "", template: "CHARACTER", publicationStatus: "WIP", categoryId: "orgs" },
  { id: "a4", title: "Unrelated title", excerpt: "", tags: "", template: "SPELL", publicationStatus: "PUBLISHED", categoryId: null },
];
const categories = [
  { id: "places", worldId: "world", name: "Places", parentId: null, order: 0 },
  { id: "orgs", worldId: "world", name: "Factions", parentId: null, order: 1 },
  { id: "covens", worldId: "world", name: "Covens", parentId: "orgs", order: 0 },
];

test("rankSearchArticles prefers title prefixes over excerpt and body-only matches", () => {
  const ranked = rankSearchArticles(articles, "Dawn");
  assert.equal(ranked[0].id, "a1");
  assert.deepEqual(ranked.map(article => article.id).slice(0, 3), ["a1", "a2", "a3"]);
});

test("paginateSearch walks ranked ids and treats a missing cursor as exhausted", () => {
  const ranked = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const first = paginateSearch(ranked, undefined, 2);
  assert.deepEqual(first.items.map(item => item.id), ["1", "2"]);
  assert.equal(first.nextCursor, "2");
  const second = paginateSearch(ranked, first.nextCursor!, 2);
  assert.deepEqual(second.items.map(item => item.id), ["3"]);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(paginateSearch(ranked, "missing", 2).items, []);
});

test("parseCampaignSearchParams and campaignSearchUrl keep owner filters bounded", () => {
  const parsed = parseCampaignSearchParams(new URLSearchParams("q=portal&template=LANDMARK&status=DRAFT&categoryId=11111111-1111-1111-1111-111111111111"));
  assert.equal(parsed.template, "LANDMARK");
  assert.equal(parsed.status, "DRAFT");
  assert.match(campaignSearchUrl("world", parsed), /template=LANDMARK/);
  assert.throws(() => parseCampaignSearchParams(new URLSearchParams("template=NOPE")), SearchInputError);
  assert.throws(() => parseCampaignSearchParams(new URLSearchParams("status=PUBLIC")), SearchInputError);
  assert.equal(articleSearchWhere("world", { q: "portal" }).worldId, "world");
});

test("presentSearchArticle shows nested category paths", () => {
  assert.equal(presentSearchArticle({ ...articles[0], categoryId: "covens" }, categories).categoryPath, "Factions / Covens");
  assert.equal(presentSearchArticle(articles[3], categories).categoryPath, "Uncategorized");
});

test("filterLocalCommands hides article entries and respects result-type filters", () => {
  const commands = [
    { id: "category-orgs", title: "Factions", description: "Category · Factions" },
    { id: "tool-home", title: "Campaign home", description: "Workspace tool" },
    { id: "article-a1", title: "Dawn Knights", description: "should not be local" },
  ];
  assert.deepEqual(filterLocalCommands(commands, "faction", "all").map(item => item.id), ["category-orgs"]);
  assert.equal(filterLocalCommands(commands, "", "articles").length, 0);
  assert.deepEqual(filterLocalCommands(commands, "", "tools").map(item => item.id), ["tool-home"]);
  assert.equal(SEARCH_PAGE_SIZE, 40);
});

test("CommandSearch renders filters and keeps the combobox accessible", () => {
  const html = renderToStaticMarkup(<CommandSearch open onOpenChange={() => undefined} worldId="world" categories={categories} commands={[]} />);
  assert(html.includes('aria-label="Search articles, categories and tools"'));
  assert(html.includes('aria-label="Result type"'));
  assert(html.includes('aria-label="Template"'));
  assert(html.includes('aria-label="Publication status"'));
  assert(html.includes('aria-label="Category"'));
  assert(html.includes("Factions / Covens"));
});
