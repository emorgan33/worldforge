import type { PrismaClient } from "@prisma/client";
import type { JSONContent } from "@tiptap/core";
import { collectHtmlReferences } from "./article-mention-index";
import { collectJsonReferences, uniqueTitleTarget } from "./article-links";
import { articleImageAssetIds } from "./asset-references";
import { parseArticleDocument, publicDocument } from "./public-content";

const BATCH_SIZE = 100;

/** Rebuild only derived reader indexes; unindexed rows continue to use full fallbacks until their batch commits. */
export async function backfillReaderReferenceIndexes(client: PrismaClient, selectedWorldId?: string) {
  const worlds = selectedWorldId
    ? [{ id: selectedWorldId }]
    : await client.world.findMany({ select: { id: true } });
  let indexedArticles = 0;
  let mentionEdges = 0;
  let assetReferences = 0;

  for (const world of worlds) {
    while (true) {
      const pending = await client.article.findMany({
        where: { worldId: world.id, OR: [{ mentionsIndexed: false }, { assetReferencesIndexed: false }] },
        select: {
          id: true, title: true, contentJson: true, contentHtml: true, version: true,
          coverImage: true, portraitImage: true, mentionsIndexed: true, assetReferencesIndexed: true,
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });
      if (!pending.length) break;

      const titles = await client.article.findMany({ where: { worldId: world.id }, select: { id: true, title: true } });
      const titlesByName = new Map<string, typeof titles>();
      for (const article of titles) titlesByName.set(article.title, [...(titlesByName.get(article.title) ?? []), article]);
      const mentionIds: string[] = [];
      const legacyMentionIds: string[] = [];
      const mentionRows: { sourceArticleId: string; targetArticleId: string; mentionText: string }[] = [];
      const assetIds: string[] = [];
      const assetRows: { sourceArticleId: string; assetId: string }[] = [];

      for (const article of pending) {
        let parsedJson: JSONContent | null = null;
        try {
          const parsed = article.contentJson ? JSON.parse(article.contentJson) : null;
          if (parsed?.type === "doc" && Array.isArray(parsed.content)) parsedJson = parsed as JSONContent;
        } catch { /* Fall back to the stored HTML representation. */ }

        if (!article.mentionsIndexed) {
          const refs = parsedJson ? collectJsonReferences(parsedJson) : collectHtmlReferences(article.contentHtml ?? "");
          const targets = new Set(refs.ids);
          for (const title of refs.titles) {
            const target = uniqueTitleTarget(title, titlesByName.get(title) ?? []);
            if (target) targets.add(target.id);
          }
          mentionIds.push(article.id);
          const hasLegacy = (article.contentHtml ?? "").includes("@[") || Boolean(parsedJson && JSON.stringify(parsedJson).includes("@["));
          if (hasLegacy) legacyMentionIds.push(article.id);
          for (const target of titles) {
            if (target.id !== article.id && targets.has(target.id)) mentionRows.push({ sourceArticleId: article.id, targetArticleId: target.id, mentionText: target.title });
          }
        }

        if (!article.assetReferencesIndexed) {
          const doc = parseArticleDocument(article.contentJson, article.contentHtml);
          const candidates = articleImageAssetIds(doc, article.coverImage, article.portraitImage);
          const publicDoc = publicDocument(doc, [], new Set(candidates), new Set());
          const references = articleImageAssetIds(publicDoc, article.coverImage, article.portraitImage);
          assetIds.push(article.id);
          for (const assetId of references) assetRows.push({ sourceArticleId: article.id, assetId });
        }
      }

      const snapshots = new Map(pending.map(article => [article.id, article]));
      let committed = 0;
      // Commit each derived index only if the article still has the version
      // used to compute it. This prevents a paused backfill from restoring a
      // placement or edge removed by a concurrent API write.
      for (const id of mentionIds) {
        const snapshot = snapshots.get(id)!;
        const rows = mentionRows.filter(row => row.sourceArticleId === id);
        await client.$transaction(async tx => {
          const claim = await tx.article.updateMany({ where: { id, version: snapshot.version, mentionsIndexed: false }, data: { mentionsIndexed: true, hasLegacyArticleLinks: legacyMentionIds.includes(id) } });
          if (claim.count !== 1) return;
          await tx.articleMention.deleteMany({ where: { sourceArticleId: id } });
          if (rows.length) await tx.articleMention.createMany({ data: rows });
          committed++;
        });
      }
      for (const id of assetIds) {
        const snapshot = snapshots.get(id)!;
        const rows = assetRows.filter(row => row.sourceArticleId === id);
        await client.$transaction(async tx => {
          const claim = await tx.article.updateMany({ where: { id, version: snapshot.version, assetReferencesIndexed: false }, data: { assetReferencesIndexed: true } });
          if (claim.count !== 1) return;
          await tx.articleAssetReference.deleteMany({ where: { sourceArticleId: id } });
          if (rows.length) await tx.articleAssetReference.createMany({ data: rows });
          committed++;
        });
      }

      indexedArticles += committed;
      mentionEdges += mentionRows.length;
      assetReferences += assetRows.length;
      if (committed === 0) break;
    }
  }

  return { worlds: worlds.length, indexedArticles, mentionEdges, assetReferences };
}
