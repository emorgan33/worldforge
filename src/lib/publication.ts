export type PublicationStatus = "DRAFT" | "WIP" | "PUBLISHED";
export type ArticleVisibility = "PRIVATE" | "PUBLIC";
export function publicationFields(input: { publicationStatus?: unknown; visibility?: unknown; state?: unknown }, existing?: { publicationStatus: string; visibility: string }): { publicationStatus: PublicationStatus; visibility: ArticleVisibility; state: PublicationStatus | "PRIVATE" } {
  const status = input.publicationStatus ?? (input.state === "PRIVATE" ? "PUBLISHED" : input.state) ?? existing?.publicationStatus ?? "DRAFT";
  const visibility = input.visibility ?? (input.state === "PRIVATE" ? "PRIVATE" : undefined) ?? existing?.visibility ?? "PRIVATE";
  if (!["DRAFT", "WIP", "PUBLISHED"].includes(String(status)) || !["PRIVATE", "PUBLIC"].includes(String(visibility))) throw new Error("Choose a valid publication status and visibility.");
  return { publicationStatus: status as PublicationStatus, visibility: visibility as ArticleVisibility, state: status === "PUBLISHED" && visibility === "PRIVATE" ? "PRIVATE" : status as PublicationStatus };
}
export function publiclyReadable(article: { publicationStatus?: string; visibility?: string }, world: { isPublic: boolean }) { return world.isPublic && article.publicationStatus === "PUBLISHED" && article.visibility === "PUBLIC"; }
export const publicArticleFilter = { publicationStatus: "PUBLISHED", visibility: "PUBLIC" } as const;
