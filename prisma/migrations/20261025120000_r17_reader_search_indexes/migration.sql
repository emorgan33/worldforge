ALTER TABLE "Article" ADD COLUMN "mentionsIndexed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Article" ADD COLUMN "hasLegacyArticleLinks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Article" ADD COLUMN "assetReferencesIndexed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Article_worldId_mentionsIndexed_hasLegacyArticleLinks_idx"
ON "Article"("worldId", "mentionsIndexed", "hasLegacyArticleLinks");

CREATE TABLE "ArticleAssetReference" (
    "sourceArticleId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    PRIMARY KEY ("sourceArticleId", "assetId"),
    CONSTRAINT "ArticleAssetReference_sourceArticleId_fkey"
      FOREIGN KEY ("sourceArticleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ArticleAssetReference_assetId_idx" ON "ArticleAssetReference"("assetId");

CREATE VIRTUAL TABLE "ArticleSearchIndex" USING fts5(
  "worldId" UNINDEXED,
  "title",
  "excerpt",
  "tags",
  "contentHtml",
  "contentJson",
  content = 'Article',
  content_rowid = 'rowid',
  tokenize = 'trigram'
);
INSERT INTO "ArticleSearchIndex" ("ArticleSearchIndex") VALUES ('rebuild');

CREATE TRIGGER "ArticleSearchIndex_insert" AFTER INSERT ON "Article" BEGIN
  INSERT INTO "ArticleSearchIndex" (rowid, "worldId", "title", "excerpt", "tags", "contentHtml", "contentJson")
  VALUES (new.rowid, new."worldId", new."title", COALESCE(new."excerpt", ''), COALESCE(new."tags", ''), COALESCE(new."contentHtml", ''), COALESCE(new."contentJson", ''));
END;

CREATE TRIGGER "ArticleSearchIndex_delete" AFTER DELETE ON "Article" BEGIN
  INSERT INTO "ArticleSearchIndex" ("ArticleSearchIndex", rowid, "worldId", "title", "excerpt", "tags", "contentHtml", "contentJson")
  VALUES ('delete', old.rowid, old."worldId", old."title", COALESCE(old."excerpt", ''), COALESCE(old."tags", ''), COALESCE(old."contentHtml", ''), COALESCE(old."contentJson", ''));
END;

CREATE TRIGGER "ArticleSearchIndex_update" AFTER UPDATE OF "worldId", "title", "excerpt", "tags", "contentHtml", "contentJson" ON "Article" BEGIN
  INSERT INTO "ArticleSearchIndex" ("ArticleSearchIndex", rowid, "worldId", "title", "excerpt", "tags", "contentHtml", "contentJson")
  VALUES ('delete', old.rowid, old."worldId", old."title", COALESCE(old."excerpt", ''), COALESCE(old."tags", ''), COALESCE(old."contentHtml", ''), COALESCE(old."contentJson", ''));
  INSERT INTO "ArticleSearchIndex" (rowid, "worldId", "title", "excerpt", "tags", "contentHtml", "contentJson")
  VALUES (new.rowid, new."worldId", new."title", COALESCE(new."excerpt", ''), COALESCE(new."tags", ''), COALESCE(new."contentHtml", ''), COALESCE(new."contentJson", ''));
END;
