import type { Prisma } from "@prisma/client";
import type { JSONContent } from "@tiptap/core";
import { Parser } from "htmlparser2";
import { collectJsonReferences, legacyLinkPattern, uniqueTitleTarget } from "./article-links";
import { articleImageAssetIds } from "./asset-references";
import { parseArticleDocument, publicDocument } from "./public-content";

export function collectHtmlReferences(html: string) {
  const ids = new Set<string>(); const titles = new Set<string>();
  const stack: boolean[] = []; let text = "";
  const flush = () => { for (const match of text.matchAll(legacyLinkPattern)) titles.add(match[1]); text = ""; };
  const parser = new Parser({
    onopentag(name, attrs) {
      flush();
      const blocked = stack.at(-1) || ["code", "pre", "script", "style"].includes(name);
      if (!blocked && name === "span" && attrs["data-article-id"]) ids.add(attrs["data-article-id"]);
      stack.push(!!blocked || name === "a" || !!attrs["data-article-id"]);
    },
    ontext(value) { if (!stack.at(-1)) text += value; },
    onclosetag() { flush(); stack.pop(); },
    onend: flush,
  }, { decodeEntities: true });
  parser.end(html);
  return { ids, titles };
}

/** Keep content and its deduplicated, world-scoped graph edges in one transaction. */
export async function syncArticleMentions(tx: Prisma.TransactionClient, worldId: string, sourceId: string, json: unknown, html: string) {
  const doc = json as JSONContent | null;
  const refs = doc?.type === "doc" && Array.isArray(doc.content) ? collectJsonReferences(doc) : collectHtmlReferences(html);
  const articles = await tx.article.findMany({ where: { worldId }, select: { id: true, title: true } });
  const targets = new Set(refs.ids);
  for (const title of refs.titles) {
    const target = uniqueTitleTarget(title, articles);
    if (target) targets.add(target.id);
  }
  await tx.articleMention.deleteMany({ where: { sourceArticleId: sourceId } });
  const data = articles.filter(article => article.id !== sourceId && targets.has(article.id)).map(article => ({ sourceArticleId: sourceId, targetArticleId: article.id, mentionText: article.title }));
  if (data.length) await tx.articleMention.createMany({ data });
  const hasLegacySyntax = html.includes("@[") || (doc ? JSON.stringify(doc).includes("@[") : false);
  await tx.$executeRaw`UPDATE Article SET mentionsIndexed = 1, hasLegacyArticleLinks = ${hasLegacySyntax} WHERE id = ${sourceId}`;
}

/** Persist exact reader-visible image placements while keeping legacy articles eligible for complete fallback scans. */
export async function syncArticleAssetReferences(
  tx: Prisma.TransactionClient,
  sourceId: string,
  json: unknown,
  html: string,
  coverImage: string | null,
  portraitImage: string | null,
) {
  const serialized = typeof json === "string" ? json : json && typeof json === "object" ? JSON.stringify(json) : null;
  const doc = parseArticleDocument(serialized, html);
  const candidateIds = articleImageAssetIds(doc, coverImage, portraitImage);
  const readerDoc = publicDocument(doc, [], new Set(candidateIds), new Set());
  const ids = articleImageAssetIds(readerDoc, coverImage, portraitImage);
  await tx.articleAssetReference.deleteMany({ where: { sourceArticleId: sourceId } });
  if (ids.length) await tx.articleAssetReference.createMany({ data: ids.map(assetId => ({ sourceArticleId: sourceId, assetId })) });
  await tx.$executeRaw`UPDATE Article SET assetReferencesIndexed = 1 WHERE id = ${sourceId}`;
}
