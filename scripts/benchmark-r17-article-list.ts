import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { rankSearchArticles } from "../src/lib/campaign-search";
import { rankedSearchPage } from "../src/lib/campaign-search-db";
import { publicArticleFilter } from "../src/lib/publication";
import { assetIsPublic, publicBacklinks } from "../src/lib/public-world";
import { documentReferences, parseArticleDocument, publicDocument } from "../src/lib/public-content";
import { backfillReaderReferenceIndexes } from "../src/lib/reader-reference-index";

const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
const PAGE_SIZE = 200;
const ARTICLE_COUNT = Number(process.env.R17_ARTICLE_COUNT ?? 2_101);
let queryCount = 0;
let peakResponseBytes = 0;
prisma.$on("query", () => { queryCount++; });

async function measure(name: string, run: () => Promise<unknown[]>) {
  const durations: number[] = [];
  let bytes = 0;
  let count = 0;
  let queries = 0;
  for (let iteration = 0; iteration < 3; iteration++) {
    queryCount = 0;
    peakResponseBytes = 0;
    const started = performance.now();
    const rows = await run();
    durations.push(performance.now() - started);
    bytes = Buffer.byteLength(JSON.stringify(rows));
    if (peakResponseBytes === 0) peakResponseBytes = bytes;
    count = rows.length;
    queries = queryCount;
  }
  durations.sort((a, b) => a - b);
  return { name, rows: count, queries, responseBytes: bytes, maxPageBytes: peakResponseBytes, medianMs: Number(durations[1].toFixed(1)) };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const databasePath = databaseUrl?.startsWith("file:") ? decodeURIComponent(databaseUrl.slice(5).split("?")[0]) : "";
  const resolvedDatabasePath = resolve(databasePath);
  const tempRoot = resolve(tmpdir()) + sep;
  const databaseDirectory = dirname(resolvedDatabasePath);
  if (!databaseUrl?.startsWith("file:") || !isAbsolute(databasePath)
    || !resolvedDatabasePath.startsWith(tempRoot)
    || !databaseDirectory.startsWith(tempRoot)
    || basename(resolvedDatabasePath) !== "test.db"
    || !/worldforge-r17-[^/]+$/.test(databaseDirectory)) {
    throw new Error("Refusing to write: DATABASE_URL must point to test.db in a dedicated worldforge-r17-* directory under the system temporary directory.");
  }
  const stamp = randomUUID();
  const owner = await prisma.user.create({ data: { name: "R17 benchmark", email: `r17-${stamp}@example.invalid` } });
  const world = await prisma.world.create({ data: { ownerId: owner.id, title: "R17 benchmark", slug: `r17-${stamp}`, isPublic: true } });
  try {
    const body = `<p>${"representative article body content ".repeat(96)}</p>`;
    const articleIds = Array.from({ length: ARTICLE_COUNT }, () => randomUUID());
    const targetId = articleIds[Math.min(1, ARTICLE_COUNT - 1)];
    const assetId = randomUUID();
    const selectiveTerm = `r17target${stamp.replaceAll("-", "")}`;
    for (let offset = 0; offset < ARTICLE_COUNT; offset += 100) {
      await prisma.article.createMany({ data: Array.from({ length: Math.min(100, ARTICLE_COUNT - offset) }, (_, index) => ({
        id: articleIds[offset + index],
        worldId: world.id,
        title: `Benchmark article ${offset + index}`,
        slug: `benchmark-${offset + index}`,
        excerpt: "Representative summary text for a large campaign world.",
        tags: offset + index === 0 ? selectiveTerm : null,
        contentHtml: offset + index === 0 ? `${body}<img src="/api/assets/${assetId}/file">` : body,
        contentJson: offset + index === 0
          ? JSON.stringify({ type: "doc", content: [{ type: "articleLink", attrs: { articleId: targetId } }, { type: "image", attrs: { src: `/api/assets/${assetId}/file` } }, { type: "paragraph", content: [{ type: "text", text: body }] }] })
          : JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] }),
        publicationStatus: "PUBLISHED",
        visibility: "PUBLIC",
        state: "PUBLISHED",
        order: offset + index,
      })) });
    }

    const where = { worldId: world.id };
    const before = await measure("unbounded full article rows", () => prisma.article.findMany({
      where,
      include: { category: { select: { id: true, name: true, icon: true } } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }));
    const after = await measure("bounded summary pages", async () => {
      const rows: unknown[] = [];
      let cursor: string | undefined;
      while (true) {
        if (cursor) await prisma.article.findFirst({ where: { ...where, id: cursor }, select: { id: true } });
        const batch = await prisma.article.findMany({
          where,
          select: {
            id: true, worldId: true, categoryId: true, template: true, title: true, slug: true, excerpt: true,
            publicationStatus: true, visibility: true, state: true, isPinned: true, order: true, wordCount: true,
            coverImage: true, coverImageAlt: true, portraitImage: true, portraitImageAlt: true,
            createdAt: true, updatedAt: true, category: { select: { id: true, name: true, icon: true } },
          },
          orderBy: [{ order: "asc" }, { id: "asc" }],
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: PAGE_SIZE + 1,
        });
        const page = batch.length > PAGE_SIZE ? batch.slice(0, PAGE_SIZE) : batch;
        peakResponseBytes = Math.max(peakResponseBytes, Buffer.byteLength(JSON.stringify(page)));
        rows.push(...page);
        if (batch.length <= PAGE_SIZE) return rows;
        cursor = page[page.length - 1].id;
      }
    });
    const measureSearch = async (query: string, label: string) => {
      const where = {
        worldId: world.id,
        AND: query.split(" ").map(term => ({ OR: [
          { title: { contains: term } }, { excerpt: { contains: term } }, { tags: { contains: term } },
          { contentHtml: { contains: term } }, { contentJson: { contains: term } },
        ] })),
      };
      const before = await measure(`${label}: full candidate fetch and rank`, async () => {
        const rows = await prisma.article.findMany({
          where,
          select: { id: true, title: true, excerpt: true, tags: true, template: true, publicationStatus: true, categoryId: true },
        });
        await prisma.category.findMany({ where: { worldId: world.id }, select: { id: true, name: true, parentId: true, order: true } });
        return rankSearchArticles(rows, query);
      });
      const after = await measure(`${label}: FTS ranked page`, async () => {
        const rows = await rankedSearchPage({ worldId: world.id, q: query, client: prisma });
        await prisma.category.findMany({ where: { worldId: world.id }, select: { id: true, name: true, parentId: true, order: true } });
        return rows;
      });
      return { before, after };
    };
    const search = await measureSearch("article content", "broad search");
    const selectiveSearch = await measureSearch(selectiveTerm, "selective search");

    const publicArticles = await prisma.article.findMany({ where: { worldId: world.id, ...publicArticleFilter }, select: { id: true, title: true } });
    const backlinksBefore = await measure("full public backlink document scan", async () => {
      const sources = await prisma.article.findMany({ where: { worldId: world.id, ...publicArticleFilter }, select: { id: true, contentJson: true, contentHtml: true } });
      sources.forEach(source => documentReferences(publicDocument(parseArticleDocument(source.contentJson, source.contentHtml), publicArticles, new Set(), new Set()), "articleLink", "articleId").has(targetId));
      return sources;
    });
    const assetsBefore = await measure("full public asset placement scan", async () => [await assetIsPublic(assetId, world.id, prisma)]);
    const assetProjectionBefore = await measure("unindexed public asset article projection", () => prisma.article.findMany({
      where: { worldId: world.id, ...publicArticleFilter, assetReferencesIndexed: false },
      select: { id: true, contentJson: true, contentHtml: true, coverImage: true, portraitImage: true },
    }));
    const indexBackfill = await backfillReaderReferenceIndexes(prisma, world.id);
    const backlinksAfter = await measure("indexed public backlinks", async () => [...await publicBacklinks(world.id, publicArticles, targetId, prisma)]);
    const assetsAfter = await measure("indexed public asset check", async () => [await assetIsPublic(assetId, world.id, prisma)]);
    const assetProjectionAfter = await measure("indexed public asset reference projection", () => prisma.articleAssetReference.findMany({
      where: { assetId, sourceArticle: { worldId: world.id, ...publicArticleFilter, assetReferencesIndexed: true } },
      select: { sourceArticleId: true },
    }));
    console.log(JSON.stringify({ articleCount: ARTICLE_COUNT, before, after, search, selectiveSearch, indexBackfill, backlinks: { before: backlinksBefore, after: backlinksAfter }, assets: { before: assetsBefore, beforeProjection: assetProjectionBefore, after: assetsAfter, afterProjection: assetProjectionAfter } }, null, 2));
  } finally {
    await prisma.world.delete({ where: { id: world.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }
}

main().finally(() => prisma.$disconnect());
