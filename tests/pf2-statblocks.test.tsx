import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatblockCard } from "../src/components/blocks/StatblockCard";
import { blockFields, validateBlockInput, type BlockStats } from "../src/lib/rpg";
const render = (category: string, stats: BlockStats) => renderToStaticMarkup(<StatblockCard block={{ id: "test", worldId: "world", system: "PF_2E", category, name: "Test entry", statsJson: JSON.stringify(stats) }} />);
const plain = (html: string) => html.replace(/<[^>]*>/g," ").replace(/\s+/g," ");
function ordered(value: string, labels: string[]) { let previous = -1; for (const label of labels) { const index = value.indexOf(label); assert(index > previous, `${label} must follow ${labels.join(', ')}`); previous = index; } }
test("Pathfinder creatures use reference order, inline modifiers and no repeated identity fields", () => {
  const html = render("NPC", { level: 0, rarity: "Unique", size: "Small", perception: "+7", languages: "Common", skills: "Stealth +8", attributes: { str: 0, dex: -1 }, items: "Lantern", ac: 16, fortitude: "+7", hp: 20, speed: "25 feet", actions: [{ name: "Ward", cost: "reaction", section: "defense", trigger: "A foe approaches", desc: "Raise a shield." }, { name: "Strike", cost: "1", desc: "Attack." }] });
  const text = plain(html); ordered(text,["Creature 0","Unique","Perception","Languages","Skills","Str","Items","AC","HP","Ward","Speed","Strike"]);
  assert.match(text,/Str 0|Str \+0/); assert.match(text,/Dex -1/); assert(!text.includes("Creature level")); assert(!text.includes("Rarity:")); assert(!text.includes("Size:")); assert(html.includes('data-action-icon="pf-reaction"'));
});
test("hazards display detection, disabling, defenses, triggers and reset without creature attributes", () => {
  const text = plain(render("HAZARD",{ level: 1, traitsText: "Mechanical, Trap", stealth: "DC 17", description: "A pressure plate", disable: "Thievery DC 17", ac: 15, hardness: 6, hp: 24, brokenThreshold: 12, actions: [{ name: "Spring", cost: "reaction", trigger: "The plate is pressed", desc: "A dart fires." }], routine: "Fire again", reset: "One minute" }));
  ordered(text,["Hazard 1","Stealth","Description","Disable","AC","Hardness","HP","BT","Spring","Trigger","Effect","Routine","Reset"]); assert(!text.includes("Speed")); assert(!text.includes("Attribute"));
});
test("feat, spell and item layouts retain requirements, action icons, degree results and heightened/special text", () => {
  const feat = plain(render("FEAT",{level:1,traitsText:"General",actionCost:"1",prerequisites:"Trained",requirements:"Healer kit",description:"Patch a wound",special:"Can be selected twice"})); ordered(feat,["Feat 1","General","Prerequisites","Requirements","Patch a wound","Special"]);
  const html = render("SPELL",{rank:0,actionCost:"2",traditions:"Primal",range:"30 feet",area:"10-foot burst",save:"basic Reflex",description:"A burst of sparks",criticalFailure:"Double damage",heightened:"(+1) Add damage"}); const spell = plain(html); ordered(spell,["Spell 0","Traditions","Range","Area","Defense","A burst","Critical Failure","Heightened"]); assert(html.includes('data-action-icon="pf-2"')); assert(!spell.includes("Armor Class"));
  const item = plain(render("ITEM",{level:2,price:"10 gp",usage:"Held",bulk:"L",activation:"Command",description:"An enchanted compass",special:"Points home"})); ordered(item,["Item 2","Price","Usage","Bulk","Activate","An enchanted compass","Special"]);
});
test("new Pathfinder category forms expose the data their layouts require and reject cross-system categories", () => {
  for (const [category,keys] of [["HAZARD",["stealth","disable","hardness","routine","reset"]],["FEAT",["prerequisites","requirements","actionCost","special"]],["SPELL",["actionCost","criticalFailure","heightened"]],["MONSTER",["items","senses","spellcasting"]]] as const) { const fields=blockFields("PF_2E",category); for(const key of keys) assert(fields.some(field=>field.key===key)); assert.equal(new Set(fields.map(f=>f.key)).size,fields.length); }
  for(const category of ["HAZARD","FEAT"]) { assert.equal(validateBlockInput({worldId:"w",name:"Entry",system:"PF_2E",category,stats:{}}),null); assert(validateBlockInput({worldId:"w",name:"Entry",system:"DND_5E",category,stats:{}})); }
});

test("legacy non-creature abilities and custom casting text remain visible with new layouts",()=>{
 const spell=plain(render("SPELL",{rank:2,actionCost:"2",cast:"10 minutes for the ritual form",description:"A ward",actions:["Legacy spell action"]})); assert(spell.includes("10 minutes for the ritual form")); assert(spell.includes("Legacy spell action"));
 const item=plain(render("ITEM",{level:1,description:"A shield",actions:[{name:"Deflect",section:"defense",cost:"reaction",desc:"Protect yourself"}]})); assert(item.includes("Deflect"));
 const klass=plain(render("CLASS",{description:"Class notes",traits:[{name:"Ward",desc:"Old feature"}],actions:["Legacy class action"],spells:["Legacy spell"]}));for(const value of ["Class notes","Old feature","Legacy class action","Legacy spell"])assert(klass.includes(value));
});
