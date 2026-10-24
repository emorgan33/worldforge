import { adjacentCreditsFor, creditIdentity, dedupeCredits, type ReaderCredit } from "@/lib/stock-credits";

function ArtworkCredit({ credit }: { credit: ReaderCredit }) {
  return <div className="space-y-1 text-sm leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
    <p><cite>{credit.title}</cite> — {credit.creditText}</p>
    {credit.modificationNotice && <p>{credit.modificationNotice}</p>}
    <p className="flex flex-wrap gap-x-3 gap-y-1">
      {credit.creatorUrl && <a href={credit.creatorUrl} className="underline">Creator</a>}
      {credit.sourceUrl && <a href={credit.sourceUrl} className="underline">Source</a>}
      {credit.licenseUrl && <a href={credit.licenseUrl} className="underline">License</a>}
    </p>
  </div>;
}

/** Credits for all stock/imported art used on a reader page. */
export function ReaderImageCredits({ credits, className = "" }: { credits: ReaderCredit[]; className?: string }) {
  const unique = dedupeCredits(credits);
  if (!unique.length) return null;
  return (
    <section aria-label="Artwork credits" className={className}>
      <h2 className="text-sm font-bold text-amber-300">Artwork credits</h2>
      <ul className="mt-2 space-y-1.5">
        {unique.map(credit => (
          <li
            key={creditIdentity(credit)}
            className="mb-3"
          >
            <ArtworkCredit credit={credit} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Caption placed directly beneath a specific figure when its art asks for adjacent credits. */
export function ReaderAdjacentCredit({ credits, assetId, className = "" }: { credits: ReaderCredit[]; assetId: string | null | undefined; className?: string }) {
  const adjacent = adjacentCreditsFor(credits, assetId);
  if (!adjacent.length) return null;
  return <figcaption className={`space-y-2 ${className}`}>{adjacent.map(credit => <ArtworkCredit key={creditIdentity(credit)} credit={credit} />)}</figcaption>;
}
