import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning existing records...");
  await prisma.installationAuditEvent.deleteMany();
  await prisma.installationAdminState.deleteMany();
  await prisma.articleMention.deleteMany();
  await prisma.marker.deleteMany();
  await prisma.markerGroup.deleteMany();
  await prisma.mapLayer.deleteMany();
  await prisma.map.deleteMany();
  await prisma.historyEvent.deleteMany();
  await prisma.era.deleteMany();
  await prisma.timeline.deleteMany();
  await prisma.variable.deleteMany();
  await prisma.variableCollection.deleteMany();
  await prisma.secret.deleteMany();
  await prisma.article.deleteMany();
  await prisma.category.deleteMany();
  await prisma.rpgBlock.deleteMany();
  await prisma.note.deleteMany();
  await prisma.noteSection.deleteMany();
  await prisma.notebook.deleteMany();
  await prisma.world.deleteMany();
  await prisma.user.deleteMany();

  console.log("Creating default Lorekeeper user...");
  const user = await prisma.user.create({
    data: {
      name: "Master Lorekeeper",
      email: "lorekeeper@worldforge.dev",
      role: "GM",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
    },
  });

  console.log("Creating demo world: Aethelgard: The Shattered Realm...");
  const world = await prisma.world.create({
    data: {
      slug: "aethelgard",
      title: "Aethelgard: The Shattered Realm",
      description: "A high-fantasy cosmos of floating continent shards, ancient leyline conduits, and arcane political intrigue.",
      genre: "High Fantasy / Arcane",
      system: "DND_5E",
      isPublic: true,
      coverImage: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80",
      bannerImage: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1920&q=80",
      ownerId: user.id,
    },
  });

  console.log("Creating category hierarchy...");
  const catKingdoms = await prisma.category.create({
    data: {
      worldId: world.id,
      name: "The Sunken Kingdoms",
      icon: "castle",
      order: 1,
    },
  });

  const catOrders = await prisma.category.create({
    data: {
      worldId: world.id,
      name: "Arcane Orders & Guilds",
      icon: "shield",
      order: 2,
    },
  });

  const catCreatures = await prisma.category.create({
    data: {
      worldId: world.id,
      name: "Creatures of the Mists",
      icon: "flame",
      order: 3,
    },
  });

  const catRelics = await prisma.category.create({
    data: {
      worldId: world.id,
      name: "Relics & Artifacts",
      icon: "gem",
      order: 4,
    },
  });

  console.log("Creating articles across multiple templates...");
  const artThronehold = await prisma.article.create({
    data: {
      worldId: world.id,
      categoryId: catKingdoms.id,
      template: "SETTLEMENT",
      title: "Thronehold, the Citadel of Glass",
      slug: "thronehold-citadel-of-glass",
      excerpt: "The grand floating capital suspended above the Shimmering Sea by titanic levitation runes.",
      state: "PUBLISHED",
      publicationStatus: "PUBLISHED",
      visibility: "PUBLIC",
      isPinned: true,
      wordCount: 840,
      coverImage: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80",
      portraitImage: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=400&q=80",
      metadata: JSON.stringify({
        population: "145,000",
        government: "Magocratic Senate",
        climate: "Temperate Highland",
        ruler: "Archmage Vaelen Sunstrider",
        defense: "Aegis Barrier of Sol",
      }),
      contentHtml: `<p>Perched atop the spire of the Sky Shard, <strong>Thronehold</strong> shines as the beating heart of mortal civilization in Aethelgard. Built during the dawn of the <em>Age of Embers</em>, its glittering spires are carved from translucent crystalline granite that refracts ambient <code>[lore:magic_source]</code> into rainbows visible for leagues.</p>
      <h3>Governance & Society</h3>
      <p>The city is governed by the <em>High Council of Seven</em>, currently presided over by @[Archmage Vaelen Sunstrider]. While commoners walk the lower terraces, scholars and arcanists dwell in the skyward tiers where the @[Order of the Silver Dawn] maintains its headquarters.</p>
      <div class="read-aloud-box"><strong>GM Narration:</strong> As your skyship docks at the Azure Pier, the hum of perpetual levitation runes vibrates in your chest. Spires of prismatic glass pierce the swirling cloudbanks above.</div>`,
      tags: "capital,settlement,floating-city,arcane",
    },
  });

  const artVaelen = await prisma.article.create({
    data: {
      worldId: world.id,
      categoryId: catOrders.id,
      template: "CHARACTER",
      title: "Archmage Vaelen Sunstrider",
      slug: "archmage-vaelen-sunstrider",
      excerpt: "First Magister of the Silver Dawn and Chancellor of the Glass Senate.",
      state: "PUBLISHED",
      publicationStatus: "PUBLISHED",
      visibility: "PUBLIC",
      isPinned: true,
      wordCount: 620,
      coverImage: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80",
      portraitImage: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80",
      metadata: JSON.stringify({
        species: "High Elf (Sunstrider Lineage)",
        age: "428 years",
        alignment: "Neutral Good (Public) / Lawful Evil (Afflicted)",
        affiliations: "Order of the Silver Dawn",
        titles: "Grand Magister of the Citadel",
      }),
      contentHtml: `<p>Renowned as the greatest chronomancer of the fourth millennium, <strong>Archmage Vaelen</strong> orchestrated the sealing of the Void Rift during the Cataclysm. Wielding the legendary @[The Sunshard Blade], he has governed @[Thronehold, the Citadel of Glass] with wisdom for over two centuries.</p>
      <h3>Arcane Capabilities</h3>
      <p>Vaelen commands both Solar Evocation and Temporal Divination, enabling him to manipulate reaction time and forecast tactical movements in battle.</p>`,
      tags: "npc,archmage,high-elf,spellcaster,leader",
    },
  });

  const artOrder = await prisma.article.create({
    data: {
      worldId: world.id,
      categoryId: catOrders.id,
      template: "ORGANIZATION",
      title: "Order of the Silver Dawn",
      slug: "order-of-the-silver-dawn",
      excerpt: "An elite fraternity of battle-mages, scholars, and templars sworn to preserve the leylines.",
      state: "PUBLISHED",
      publicationStatus: "PUBLISHED",
      visibility: "PUBLIC",
      wordCount: 510,
      metadata: JSON.stringify({
        founded: "Year 120 of the First Era",
        headquarters: "Thronehold Upper Spire",
        leader: "Archmage Vaelen Sunstrider",
        motto: "Lux in Tenebris (Light within the Dark)",
      }),
      contentHtml: `<p>The <strong>Order of the Silver Dawn</strong> was forged during the War of the Sundered Sky to prevent destructive misuse of leyline nexuses. Today, their paladins patrol the trade skyships between floating continents while their scribes archive forbidden eldritch manuscripts.</p>`,
      tags: "faction,knights,mages,paladins",
    },
  });

  const artBlade = await prisma.article.create({
    data: {
      worldId: world.id,
      categoryId: catRelics.id,
      template: "ITEM",
      title: "The Sunshard Blade",
      slug: "the-sunshard-blade",
      excerpt: "A crystalline rapier forged from crystallized solar plasma that cuts through magical wards.",
      state: "PUBLISHED",
      publicationStatus: "PUBLISHED",
      visibility: "PUBLIC",
      wordCount: 380,
      metadata: JSON.stringify({
        rarity: "Artifact (Requires Attunement)",
        weaponType: "Rapier / Finesse",
        damage: "1d8 Piercing + 2d6 Radiant",
        properties: "Bypasses magical shields; blinds enemies on critical hits.",
      }),
      contentHtml: `<p>Crafted by ancient solar smiths, <strong>The Sunshard Blade</strong> emits a continuous warm luminescence. It is traditionally borne by the Chancellor of @[Thronehold, the Citadel of Glass].</p>`,
      tags: "artifact,weapon,magic-item,radiant",
    },
  });

  await prisma.article.create({
    data: {
      worldId: world.id,
      categoryId: catCreatures.id,
      template: "SPECIES",
      title: "Aether Wyrm",
      slug: "aether-wyrm",
      excerpt: "Colossal crystalline serpents that swim through the void streams between continent shards.",
      state: "PUBLISHED",
      publicationStatus: "PUBLISHED",
      visibility: "PUBLIC",
      wordCount: 420,
      metadata: JSON.stringify({
        classification: "Draconic Void Beast",
        averageLength: "90 - 150 feet",
        diet: "Raw Leyline Energy & Astral Dust",
        threatLevel: "Deadly (CR 14)",
      }),
      contentHtml: `<p>The <strong>Aether Wyrm</strong> is revered and feared by skyship captains across Aethelgard. Lacking physical wings, they undulate along lines of gravitational distortion and are capable of breathing beams of concentrated arcane force.</p>`,
      tags: "monster,dragon,beast,aerial",
    },
  });

  console.log("Setting up bidirectional mentions...");
  await prisma.articleMention.createMany({
    data: [
      { sourceArticleId: artThronehold.id, targetArticleId: artVaelen.id, mentionText: "Archmage Vaelen Sunstrider" },
      { sourceArticleId: artThronehold.id, targetArticleId: artOrder.id, mentionText: "Order of the Silver Dawn" },
      { sourceArticleId: artVaelen.id, targetArticleId: artThronehold.id, mentionText: "Thronehold, the Citadel of Glass" },
      { sourceArticleId: artVaelen.id, targetArticleId: artBlade.id, mentionText: "The Sunshard Blade" },
    ],
  });

  console.log("Creating GM secrets...");
  await prisma.secret.createMany({
    data: [
      {
        worldId: world.id,
        articleId: artVaelen.id,
        title: "The Archmage's Affliction",
        content: "Archmage Vaelen is secretly afflicted by the Void Rot contracted when he sealed the rift. He requires monthly infusions of pure Aether crystals to maintain his sanity, and the Nether Cult is blackmailing him for access to the city wards.",
        isRevealed: false,
      },
      {
        worldId: world.id,
        articleId: artThronehold.id,
        title: "The Obsidian Cellar",
        content: "Beneath the Throne of Glass lies an ancient adamantine vault containing the slumbering heart of a Primordial Titan. If awakened, the floating island will plummet.",
        isRevealed: false,
      },
    ],
  });

  console.log("Creating variable macro collections...");
  await prisma.variableCollection.create({
    data: {
      worldId: world.id,
      name: "Chronology & Epochs",
      prefix: "cal",
      description: "Calendar tracking and official year designations.",
      variables: {
        create: [
          { key: "current_year", title: "Current Year", type: "NUMBER", value: "1428 AE", description: "After the Cataclysm" },
          { key: "era", title: "Current Era", type: "TERM_SIMPLE", value: "The Age of Embers", description: "The present era of restoration" },
        ],
      },
    },
  });

  await prisma.variableCollection.create({
    data: {
      worldId: world.id,
      name: "Imperial Currency",
      prefix: "coin",
      description: "Standard currency exchange units in the Citadel.",
      variables: {
        create: [
          { key: "gold", title: "Gold Currency", type: "TERM_ADVANCED", value: "Crown of Sol (pure sun-gold coin)", description: "Standard high-value currency" },
          { key: "silver", title: "Silver Currency", type: "TERM_SIMPLE", value: "Lunar Shilling", description: "Everyday merchant trade coin" },
        ],
      },
    },
  });

  await prisma.variableCollection.create({
    data: {
      worldId: world.id,
      name: "Cosmology & Laws",
      prefix: "lore",
      description: "Foundational worldbuilding constants.",
      variables: {
        create: [
          { key: "magic_source", title: "Source of Arcana", type: "TERM_ADVANCED", value: "The Aetherflux", description: "Omnipresent radiant energy current" },
          { key: "world_name", title: "World Name", type: "TERM_SIMPLE", value: "Aethelgard", description: "The shattered world" },
        ],
      },
    },
  });

  console.log("Creating interactive map & markers...");
  const map = await prisma.map.create({
    data: {
      worldId: world.id,
      title: "The Shattered Continent of Aethelgard",
      description: "High-altitude cartographic chart of the major airborne island realms and air routes.",
      imageUrl: "https://images.unsplash.com/photo-1524654458049-e36be0721fa2?auto=format&fit=crop&w=2000&q=80",
      width: 2560,
      height: 1440,
      defaultZoom: 1.0,
      layers: {
        create: [
          { name: "Upper Atmosphere & Floating Isles", order: 1, isVisible: true },
          { name: "The Mist Sea (Lower Wastes)", order: 2, isVisible: true },
          { name: "Leyline Conduits", order: 3, isVisible: false },
        ],
      },
      markerGroups: {
        create: [
          { name: "Major Citadels", color: "#3b82f6", icon: "castle" },
          { name: "Dungeons & Ruins", color: "#ef4444", icon: "skull" },
          { name: "Arcane Nexuses", color: "#8b5cf6", icon: "zap" },
        ],
      },
    },
    include: {
      markerGroups: true,
      layers: true,
    },
  });

  const groupCitadel = map.markerGroups.find((g) => g.name === "Major Citadels");
  const groupDungeons = map.markerGroups.find((g) => g.name === "Dungeons & Ruins");
  const layerUpper = map.layers.find((l) => l.name === "Upper Atmosphere & Floating Isles");

  await prisma.marker.createMany({
    data: [
      {
        mapId: map.id,
        layerId: layerUpper?.id,
        groupId: groupCitadel?.id,
        title: "Thronehold Citadel",
        description: "The floating city of glass and capital of the realm.",
        x: 48.5,
        y: 35.2,
        articleId: artThronehold.id,
        color: "#3b82f6",
        icon: "castle",
      },
      {
        mapId: map.id,
        layerId: layerUpper?.id,
        groupId: groupDungeons?.id,
        title: "The Sunken Spire of Xur",
        description: "Crumbling ruins infested with void cultists.",
        x: 68.2,
        y: 62.1,
        color: "#ef4444",
        icon: "skull",
      },
      {
        mapId: map.id,
        layerId: layerUpper?.id,
        groupId: groupCitadel?.id,
        title: "Highspire Observatory",
        description: "Stargazer tower tracking astral incursions.",
        x: 25.4,
        y: 50.8,
        color: "#8b5cf6",
        icon: "eye",
      },
    ],
  });

  console.log("Creating historical timeline & events...");
  const timeline = await prisma.timeline.create({
    data: {
      worldId: world.id,
      title: "Chronicles of the Sundered Sky",
      description: "Official timeline from the Great Cataclysm to the current era.",
      coverImage: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
      eras: {
        create: [
          { name: "The Age of Harmony", startYear: -1000, endYear: 0, order: 1, color: "#10b981" },
          { name: "The Cataclysm & Sundering", startYear: 0, endYear: 150, order: 2, color: "#ef4444" },
          { name: "The Age of Embers (Current)", startYear: 150, endYear: 1500, order: 3, color: "#f59e0b" },
        ],
      },
    },
    include: {
      eras: true,
    },
  });

  const eraCataclysm = timeline.eras.find((e) => e.name.includes("Cataclysm"));
  const eraEmbers = timeline.eras.find((e) => e.name.includes("Embers"));

  await prisma.historyEvent.createMany({
    data: [
      {
        timelineId: timeline.id,
        eraId: eraCataclysm?.id,
        title: "The Great Sundering of Aethelgard",
        dateDisplay: "Year 0 (The Shattering)",
        numericDate: 0,
        description: "Overdrawing from the world core caused the planetary mantle to shatter into thousands of airborne fragments.",
        importance: 5,
      },
      {
        timelineId: timeline.id,
        eraId: eraEmbers?.id,
        title: "Founding of Thronehold Citadel",
        dateDisplay: "Year 180 AE",
        numericDate: 180,
        description: "Refugees anchored seven floating islands together to establish the city of glass.",
        articleId: artThronehold.id,
        importance: 4,
      },
      {
        timelineId: timeline.id,
        eraId: eraEmbers?.id,
        title: "Consecration of the Silver Dawn",
        dateDisplay: "Year 245 AE",
        numericDate: 245,
        description: "Archmage Vaelen formed the Order to police unauthorized arcane experimentation.",
        articleId: artOrder.id,
        importance: 4,
      },
    ],
  });

  console.log("Creating RPG statblocks...");
  await prisma.rpgBlock.createMany({
    data: [
      {
        worldId: world.id,
        system: "DND_5E",
        category: "NPC",
        name: "Archmage Vaelen Sunstrider",
        statsJson: JSON.stringify({
          cr: "16",
          size: "Medium humanoid (High Elf)",
          ac: 17,
          hp: "144 (18d8 + 36)",
          speed: "30 ft., fly 60 ft.",
          stats: { str: 10, dex: 16, con: 14, int: 22, wis: 16, cha: 18 },
          savingThrows: "Int +11, Wis +8, Cha +9",
          skills: "Arcana +16, History +16, Insight +8",
          spells: [
            "Cantrips: Light, Mage Hand, Ray of Frost, Prestidigitation",
            "1st level (4 slots): Shield, Mage Armor, Magic Missile",
            "3rd level (3 slots): Counterspell, Fireball, Haste",
            "5th level (2 slots): Cone of Cold, Wall of Force, Telekinesis",
            "7th level (1 slot): Forcecage, Teleport",
            "9th level (1 slot): Time Stop",
          ],
          actions: [
            "Solar Flare: Ranged Spell Attack: +11 to hit, reach 120 ft., one target. Hit: 28 (4d10 + 6) radiant damage.",
            "Temporal Shift (Recharge 5-6): Vaelen shifts through time up to 60 ft. without provoking opportunity attacks and becomes invisible until end of turn.",
          ],
        }),
      },
      {
        worldId: world.id,
        system: "DND_5E",
        category: "MONSTER",
        name: "Aether Wyrm",
        statsJson: JSON.stringify({
          cr: "14",
          size: "Gargantuan dragon (Void)",
          ac: 19,
          hp: "210 (14d20 + 70)",
          speed: "0 ft., fly 90 ft. (hover)",
          stats: { str: 24, dex: 18, con: 20, int: 8, wis: 14, cha: 12 },
          damageImmunities: "Radiant, Force",
          actions: [
            "Multiattack: Makes one Bite and two Tail attacks.",
            "Bite: Melee Weapon Attack: +12 to hit, reach 15 ft. Hit: 23 (3d10 + 7) piercing damage plus 9 (2d8) radiant damage.",
            "Aether Flux Breath (Recharge 5-6): Exhales a 60-foot cone of pure arcane plasma. DC 18 Dexterity saving throw, taking 54 (12d8) force damage on failure.",
          ],
        }),
      },
    ],
  });

  console.log("Creating GM Campaign Notebook...");
  await prisma.notebook.create({
    data: {
      worldId: world.id,
      title: "Campaign: The Sundered Prophecy",
      description: "GM prep notes, encounter rosters, and weekly session chronicles.",
      sections: {
        create: [
          {
            title: "Session Prep",
            order: 1,
            notes: {
              create: [
                {
                  title: "Session 12: Infiltration of the Glass Citadel",
                  content: "The party disguised themselves as Silver Dawn acolytes. Remember to trigger the Aegis alarm if Rogar uses his cursed dagger.",
                  order: 1,
                },
                {
                  title: "Session 13: Confronting Archmage Vaelen",
                  content: "Vaelen will offer them a diplomatic resolution before revealing the Void infection.",
                  order: 2,
                },
              ],
            },
          },
          {
            title: "Plot Threads & Clues",
            order: 2,
            notes: {
              create: [
                {
                  title: "The Black Sun Mark",
                  content: "Appeared on the arm of the guildmaster. Points to the Nether Cult hiding inside District 4.",
                  order: 1,
                },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.installationAdminState.create({ data: { id: 1, version: 1 } });

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
