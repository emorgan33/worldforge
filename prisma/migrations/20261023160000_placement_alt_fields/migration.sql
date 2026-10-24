-- Placement-specific image descriptions. A NULL keeps the legacy presentation
-- (the renderer's existing fallback); an empty string explicitly marks the
-- artwork as decorative. These are separate from ImageAsset.alt, which remains
-- an editable library default.
ALTER TABLE "World" ADD COLUMN "coverImageAlt" TEXT;
ALTER TABLE "World" ADD COLUMN "bannerImageAlt" TEXT;
ALTER TABLE "Article" ADD COLUMN "coverImageAlt" TEXT;
ALTER TABLE "Article" ADD COLUMN "portraitImageAlt" TEXT;

-- Optional category illustration, separate from the interface icon identifier.
ALTER TABLE "Category" ADD COLUMN "iconImage" TEXT;

-- Snapshot placement images and descriptions so history can restore them.
ALTER TABLE "ArticleRevision" ADD COLUMN "coverImage" TEXT;
ALTER TABLE "ArticleRevision" ADD COLUMN "coverImageAlt" TEXT;
ALTER TABLE "ArticleRevision" ADD COLUMN "portraitImage" TEXT;
ALTER TABLE "ArticleRevision" ADD COLUMN "portraitImageAlt" TEXT;
