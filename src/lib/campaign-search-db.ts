import { Prisma, type PrismaClient } from "@prisma/client";
import type { ArticleTemplateType } from "@/types";
import { campaignSearchRank, SEARCH_PAGE_SIZE, searchTerms, type PublicationStatusFilter, type SearchableArticle } from "./campaign-search";
import { prisma } from "./db";

export interface RankedSearchPageInput {
  worldId: string;
  q: string;
  cursor?: string;
  template?: ArticleTemplateType;
  status?: PublicationStatusFilter;
  categoryId?: string;
  readableArticleIds?: string[];
  searchBodies?: boolean;
  client?: Pick<PrismaClient, "$queryRaw">;
}

export interface RankedSearchRow {
  id: string;
  title: string;
  excerpt: string | null;
  tags: string | null;
  template: string;
  publicationStatus: string;
  categoryId: string | null;
}

const FTS_CANDIDATE_THRESHOLD = 200;
const SEARCH_SCAN_BATCH_SIZE = 2_000;
interface RankedSearchScanRow extends RankedSearchRow { rowid: bigint | number | string }

/** Narrow candidates in SQLite, then rank and page with the shared JS semantics. */
export async function rankedSearchPage(input: RankedSearchPageInput) {
  const client = input.client ?? prisma;
  const terms = searchTerms(input.q);
  const predicates: Prisma.Sql[] = [Prisma.sql`a."worldId" = ${input.worldId}`];
  if (input.template) predicates.push(Prisma.sql`a."template" = ${input.template}`);
  if (input.status) predicates.push(Prisma.sql`a."publicationStatus" = ${input.status}`);
  if (input.categoryId) predicates.push(Prisma.sql`a."categoryId" = ${input.categoryId}`);
  if (input.readableArticleIds) {
    if (input.readableArticleIds.length === 0) predicates.push(Prisma.sql`1 = 0`);
    else predicates.push(Prisma.sql`a."id" IN (${Prisma.join(input.readableArticleIds)})`);
  }

  const ftsTerms = terms.filter(term => term.length >= 3 && /^[\x20-\x7e]+$/.test(term) && !/[%_]/.test(term));
  // FTS narrows the candidate set. Keep SQLite LIKE as the compatibility
  // predicate because trigram normalization can equate distinct Unicode forms.
  for (const term of terms) {
    const pattern = `%${term}%`;
    predicates.push(input.searchBodies === false ? Prisma.sql`(
      a."title" LIKE ${pattern}
      OR COALESCE(a."excerpt", '') LIKE ${pattern}
      OR COALESCE(a."tags", '') LIKE ${pattern}
    )` : Prisma.sql`(
      a."title" LIKE ${pattern}
      OR COALESCE(a."excerpt", '') LIKE ${pattern}
      OR COALESCE(a."tags", '') LIKE ${pattern}
      OR COALESCE(a."contentHtml", '') LIKE ${pattern}
      OR COALESCE(a."contentJson", '') LIKE ${pattern}
    )`);
  }

  // Trigram FTS narrows ASCII terms of at least three characters. The LIKE
  // predicates above retain the existing substring and Unicode semantics.
  // Player search restricts FTS to its summary columns.
  const ftsParts = (afterRowid: bigint) => {
    if (!ftsTerms.length) return { cte: Prisma.empty, predicate: Prisma.empty };
    const quoted = (term: string) => `"${term.replaceAll('"', '""')}"`;
    const ftsExpression = ftsTerms.map(term => input.searchBodies === false
      ? `(title : ${quoted(term)} OR excerpt : ${quoted(term)} OR tags : ${quoted(term)})`
      : quoted(term)).join(" AND ");
    return {
      cte: Prisma.sql`WITH fts_candidates AS MATERIALIZED (
        SELECT rowid FROM "ArticleSearchIndex"
        WHERE "ArticleSearchIndex" MATCH ${ftsExpression} AND "worldId" = ${input.worldId} AND rowid > ${afterRowid}
        LIMIT ${FTS_CANDIDATE_THRESHOLD + 1}
      )`,
      predicate: Prisma.sql`AND (
        (SELECT COUNT(*) FROM fts_candidates) > ${FTS_CANDIDATE_THRESHOLD}
        OR a.rowid IN (SELECT rowid FROM fts_candidates)
      )`,
    };
  };

  const termsForRank = searchTerms(input.q);
  const needle = input.q.trim().toLocaleLowerCase();
  const rank = (row: RankedSearchRow) => campaignSearchRank(row satisfies SearchableArticle, termsForRank, needle);
  const compare = (a: RankedSearchRow, b: RankedSearchRow) => rank(a) - rank(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  const cursorRows = input.cursor ? await client.$queryRaw<RankedSearchRow[]>(Prisma.sql`
    SELECT a."id", a."title", a."excerpt", a."tags", a."template", a."publicationStatus", a."categoryId"
    FROM "Article" a
    WHERE ${Prisma.join([...predicates, Prisma.sql`a."id" = ${input.cursor}`], " AND ")}
    LIMIT 1
  `) : [];
  const cursorRow = cursorRows[0];
  if (input.cursor && !cursorRow) return [];

  // SQLite cannot reproduce localeCompare or JS Unicode lowercasing. Scan by
  // rowid (and push that boundary into FTS) while retaining only the next page
  // under the shared JS comparator. Each iteration advances monotonically,
  // so previous candidate ranges are never scanned again.
  const rows: RankedSearchRow[] = [];
  let lastRowid = BigInt(0);
  let hasMore = true;
  while (hasMore) {
    const { cte, predicate } = ftsParts(lastRowid);
    const batch = await client.$queryRaw<RankedSearchScanRow[]>(Prisma.sql`
      ${cte}
      SELECT a.rowid AS "rowid", a."id", a."title", a."excerpt", a."tags", a."template", a."publicationStatus", a."categoryId"
      FROM "Article" a
      WHERE ${Prisma.join([...predicates, Prisma.sql`a.rowid > ${lastRowid}`], " AND ")}
      ${predicate}
      ORDER BY a.rowid
      LIMIT ${SEARCH_SCAN_BATCH_SIZE}
    `);
    hasMore = batch.length === SEARCH_SCAN_BATCH_SIZE;
    if (batch.length) lastRowid = BigInt(batch[batch.length - 1].rowid);
    for (const scanRow of batch) {
      const candidate: RankedSearchRow = {
        id: scanRow.id,
        title: scanRow.title,
        excerpt: scanRow.excerpt,
        tags: scanRow.tags,
        template: scanRow.template,
        publicationStatus: scanRow.publicationStatus,
        categoryId: scanRow.categoryId,
      };
      if (cursorRow && compare(candidate, cursorRow) <= 0) continue;
      rows.push(candidate);
    }
    rows.sort(compare);
    if (rows.length > SEARCH_PAGE_SIZE + 1) rows.length = SEARCH_PAGE_SIZE + 1;
  }
  return rows;
}
