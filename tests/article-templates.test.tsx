import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ARTICLE_TEMPLATES, getArticleTemplate, templateFieldGroups, validateTemplateMetadata } from "../src/lib/templates";
import { articleFacts, articleStatblock, articleStatblockKey, isEmptyArticle, starterOutline } from "../src/lib/article-template-content";
import { ArticleQuickFacts } from "../src/components/article/ArticleQuickFacts";
import { parseArticleDraft } from "../src/lib/article-drafts";
import { type RpgBlockItem } from "../src/lib/rpg";

for (const system of ["DND_5E", "PF_2E"]) test(`${system} has five distinct structured templates with unique fields and starter sections`, () => {
  for (const type of ["CHARACTER", "CREATURE", "SPELL", "ITEM", "ENCOUNTER"] as const) {
    const template = getArticleTemplate(type, system);
    assert(template.fields.length > 5); assert(template.starterSections!.length > 1);
    assert.equal(new Set(template.fields.map(field => field.key)).size, template.fields.length);
    assert.equal(templateFieldGroups(template).flatMap(group => group.fields).length, template.fields.length);
  }
  assert.equal(getArticleTemplate("CREATURE", "CUSTOM"), ARTICLE_TEMPLATES.CREATURE);
});

test("system fields keep 2014 scores, CR and components separate from Remaster modifiers, level and rank", () => {
  const dnd = getArticleTemplate("CREATURE", "DND_5E"); const pf = getArticleTemplate("CREATURE", "PF_2E");
  assert(dnd.fields.some(field => field.key === "dnd5eCr" && field.type === "text"));
  assert(pf.fields.some(field => field.key === "pf2eCreatureLevel" && field.min === -1));
  assert(pf.fields.some(field => field.label === "STR modifier")); assert(dnd.fields.some(field => field.label === "STR score"));
  assert(!pf.fields.some(field => /alignment|challenge rating/i.test(field.label)));
  assert(!getArticleTemplate("SPELL", "PF_2E").fields.some(field => /components|school/i.test(field.label)));
  assert(getArticleTemplate("SPELL", "DND_5E").fields.some(field => field.label === "Concentration"));
  assert.deepEqual(getArticleTemplate("ENCOUNTER", "DND_5E").fields.find(field => field.key === "dnd5eDifficulty")!.options, ["Easy", "Medium", "Hard", "Deadly"]);
  assert.deepEqual(getArticleTemplate("ENCOUNTER", "PF_2E").fields.find(field => field.key === "pf2eThreat")!.options, ["Trivial", "Low", "Moderate", "Severe", "Extreme"]);
});

test("numeric authoring checks retain zero and negatives, allow blank values and preserve unchanged legacy text", () => {
  const creature = getArticleTemplate("CREATURE", "PF_2E");
  assert.equal(validateTemplateMetadata(creature, { pf2eCreatureLevel: "-1", pf2eSTR: "0" }), null);
  assert(validateTemplateMetadata(creature, { pf2eCreatureLevel: "-2" }));
  const spell = getArticleTemplate("SPELL", "DND_5E");
  assert.equal(validateTemplateMetadata(spell, { dnd5eSpellLevel: "0" }), null);
  assert(validateTemplateMetadata(spell, { dnd5eSpellLevel: "10" }));
  assert(validateTemplateMetadata(spell, { dnd5eSpellLevel: "1.5" }));
  assert.equal(validateTemplateMetadata(spell, { dnd5eSpellLevel: "" }), null);
  assert.equal(validateTemplateMetadata(spell, { dnd5eSpellLevel: "old custom value" }, { dnd5eSpellLevel: "old custom value" }), null);
});

test("starter outlines never classify images, tables, embeds or existing headings as empty", () => {
  assert(isEmptyArticle("<p><br></p>")); assert(isEmptyArticle("", { type: "doc", content: [{ type: "paragraph" }] }));
  for (const type of ["image", "table", "campaignStatblock", "articleLink", "heading", "horizontalRule"]) assert(!isEmptyArticle("", { type: "doc", content: [{ type }] }));
  assert(!isEmptyArticle('<img src="https://example.com/map.jpg">')); assert(!isEmptyArticle("<p>Existing lore.</p>"));
  const doc = starterOutline(["Scene", "Outcomes"]); assert.equal(doc.content!.length, 4); assert.equal(doc.content![0].content![0].text, "Scene");
});

test("quick facts display active grouped values, preserve other-profile metadata and reject mismatched compendium links", () => {
  const block: RpgBlockItem = { id: "guard", worldId: "world", name: "Remaster guard", category: "MONSTER", system: "PF_2E", statsJson: '{"level":0}' };
  const metadata = { pf2eCreatureLevel: "0", pf2eSTR: "-1", dnd5eCr: "1/2", unknownNote: "Retain me", [articleStatblockKey("PF_2E")]: "guard" };
  assert.equal(articleStatblock("CREATURE", "PF_2E", metadata, [block])?.id, "guard");
  assert.equal(articleStatblock("SPELL", "PF_2E", metadata, [block]), undefined);
  assert.equal(articleStatblock("CREATURE", "DND_5E", metadata, [block]), undefined);
  const facts = articleFacts(getArticleTemplate("CREATURE", "PF_2E"), metadata);
  assert.equal(facts.groups.find(group => group.name === "Profile")!.fields.find(field => field.key === "pf2eCreatureLevel")!.value, "0");
  assert(facts.other.some(field => field.key === "dnd5eCr")); assert(facts.other.some(field => field.value === "Retain me"));
  const output = renderToStaticMarkup(<ArticleQuickFacts template="CREATURE" system="PF_2E" metadata={metadata} blocks={[block]} />);
  assert.match(output, /Attribute modifiers/); assert.match(output, /Remaster guard/); assert.match(output, /Other saved details/); assert.doesNotMatch(output, /pf2eStatblockId/);
});

test("local draft recovery recognizes the new Creature and Encounter templates", () => {
  for (const template of ["CREATURE", "ENCOUNTER"]) {
    const raw = JSON.stringify({ version: 1, data: { worldId: "world", template, title: "Fixture", categoryId: null, excerpt: "", tags: "", state: "DRAFT", contentHtml: "", metadata: { rulesSystem: "PF_2E" } } });
    assert.equal(parseArticleDraft(raw, "world")!.data.template, template);
  }
});

test("encounter templates include structured participant fields and environment details", () => {
  for (const system of ["DND_5E", "PF_2E"] as const) {
    const template = getArticleTemplate("ENCOUNTER", system);
    const prefix = system === "PF_2E" ? "pf2e" : "dnd5e";
    
    // Check participant fields exist
    for (let i = 1; i <= 6; i++) {
      assert(template.fields.some(f => f.key === `${prefix}Participant${i}`), `Participant ${i} field missing for ${system}`);
    }
    
    // Check environment fields exist
    assert(template.fields.some(f => f.key === `${prefix}Conditions`), `Conditions field missing for ${system}`);
    assert(template.fields.some(f => f.key === `${prefix}TerrainFeatures`), `Terrain features field missing for ${system}`);
    assert(template.fields.some(f => f.key === `${prefix}Weather`), `Weather field missing for ${system}`);
    
    // Check Participants group exists
    const groups = templateFieldGroups(template);
    assert(groups.some(g => g.name === "Participants"), `Participants group missing for ${system}`);
    assert(groups.some(g => g.name === "Environment"), `Environment group missing for ${system}`);
    
    // Check party/difficulty fields
    assert(template.fields.some(f => f.key === `${prefix}PartyLevel`), `Party level field missing for ${system}`);
    assert(template.fields.some(f => f.key === `${prefix}PartySize`), `Party size field missing for ${system}`);
    assert(template.fields.some(f => f.key === `${prefix}XpBudget`), `XP budget field missing for ${system}`);
    
    // Check session prep linking fields
    assert(template.fields.some(f => f.key === "linkedLocation"), `linkedLocation field missing for ${system}`);
    assert(template.fields.some(f => f.key === "linkedPlot"), `linkedPlot field missing for ${system}`);
    assert(template.fields.some(f => f.key === "linkedSession"), `linkedSession field missing for ${system}`);
  }
});

test("session report and plot templates include session preparation linking fields", () => {
  for (const system of ["DND_5E", "PF_2E"] as const) {
    // REPORT template
    const report = getArticleTemplate("REPORT", system);
    assert(report.fields.length > 5, `REPORT should have multiple fields for ${system}`);
    assert(report.fields.some(f => f.key === "sessionNumber"), `sessionNumber field missing for ${system}`);
    assert(report.fields.some(f => f.key === "linkedEncounters"), `linkedEncounters field missing for ${system}`);
    assert(report.fields.some(f => f.key === "linkedPlots"), `linkedPlots field missing for ${system}`);
    assert(report.fields.some(f => f.key === "linkedLocations"), `linkedLocations field missing for ${system}`);
    assert(report.fields.some(f => f.key === "recap"), `recap field missing for ${system}`);
    assert(report.fields.some(f => f.key === "nextSession"), `nextSession field missing for ${system}`);
    
    // PLOT template
    const plot = getArticleTemplate("PLOT", system);
    assert(plot.fields.length > 3, `PLOT should have multiple fields for ${system}`);
    assert(plot.fields.some(f => f.key === "act"), `act field missing for ${system}`);
    assert(plot.fields.some(f => f.key === "linkedEncounters"), `linkedEncounters field missing for ${system}`);
    assert(plot.fields.some(f => f.key === "linkedSessions"), `linkedSessions field missing for ${system}`);
    assert(plot.fields.some(f => f.key === "previousPlot"), `previousPlot field missing for ${system}`);
    assert(plot.fields.some(f => f.key === "nextPlot"), `nextPlot field missing for ${system}`);
    
    // Check groups
    const reportGroups = templateFieldGroups(report);
    const plotGroups = templateFieldGroups(plot);
    assert(reportGroups.some(g => g.name === "Related Articles"), `REPORT should have Related Articles group for ${system}`);
    assert(reportGroups.some(g => g.name === "Planning"), `REPORT should have Planning group for ${system}`);
    assert(plotGroups.some(g => g.name === "Session Prep"), `PLOT should have Session Prep group for ${system}`);
  }
});
