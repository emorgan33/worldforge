"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import { WorldPresentation } from "@/components/public/WorldPresentation";
import { DEFAULT_APPEARANCE, parseAppearance, rulesTheme, WORLD_THEMES, READING_WIDTHS, type WorldAppearance } from "@/lib/world-appearance";
import { ImageSourceField } from "@/components/assets/ImageSourceField";
import { useState } from "react";
import { RPG_SYSTEMS, systemProfile } from "@/lib/rpg";
import { sortOrdered } from "@/lib/category-tree";
import { ArticleListItem, CategoryItem } from "@/types";
import { FoundryImport } from "@/components/foundry/FoundryImport";
import type { GuardRegistration } from "@/lib/navigation-guard";

export interface WorldSummary {
  id: string;
  slug: string;
  isPublic: boolean;
  title: string;
  system: string;
  description: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  appearance?: string | null;
  categories: CategoryItem[];
}

export function WorldHome({ world, articles, onSave, onSelectArticle, onRefreshBlocks, onOpenBlock, onGuardChange }: {
  world: WorldSummary;
  articles: ArticleListItem[];
  onSave: (world: WorldSummary) => void;
  onSelectArticle: (id: string) => void;
  onRefreshBlocks?: () => Promise<void> | void;
  onOpenBlock?: (id: string) => void;
  onGuardChange?: (registration: GuardRegistration) => void;
}) {
  const [campaignSystem, setCampaignSystem] = useState(world.system);
  const [appearance, setAppearance] = useState(() => parseAppearance(world.appearance));
  const [coverImage, setCoverImage] = useState(world.coverImage || "");
  const [bannerImage, setBannerImage] = useState(world.bannerImage || "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const published = sortOrdered(articles.filter(article => (article.publicationStatus || article.state) === "PUBLISHED"));

  useWorldGuard({ dirty: editing, busy }, "settings", onGuardChange);
  
  // Build O(1) lookup: categoryId → articles (avoids scanning all articles per category)
  const articlesByCategory = new Map<string | null, ArticleListItem[]>();
  for (const article of published) {
    const key = article.categoryId ?? null;
    if (!articlesByCategory.has(key)) articlesByCategory.set(key, []);
    articlesByCategory.get(key)!.push(article);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/worlds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: world.id, ...Object.fromEntries(data), isPublic: data.get("isPublic") === "on", appearance }),
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || "Could not save your world. Please try again."); }
      onSave(await response.json());
      setEditing(false);
      setMessage("World updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your world.");
    } finally {
      setBusy(false);
    }
  }

  function articleLinks(categoryId: string | null) {
    return (articlesByCategory.get(categoryId) ?? []).map(article => (
      <li key={article.id}>
        <button className="py-2 text-left text-indigo-300 hover:underline" disabled={editing} onClick={() => onSelectArticle(article.id)}>{article.title}</button>
      </li>
    ));
  }

  function categoryTree(parentId: string | null, ancestors: string[] = []) {
    return sortOrdered(world.categories.filter(category => (category.parentId ?? null) === parentId && !ancestors.includes(category.id))).map(category => (
      <li key={category.id} className="border-l border-zinc-700 pl-4 py-2">
        <h3 className="font-semibold">{category.name}</h3>
        <ul>{articleLinks(category.id)}{categoryTree(category.id, [...ancestors, category.id])}</ul>
      </li>
    ));
  }

  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs uppercase tracking-widest text-indigo-400">Articles & World Manager</p><h1 className="text-2xl font-bold">World homepage</h1></div>
      <button className="rounded-lg border border-zinc-700 px-4 py-2 hover:bg-zinc-800" onClick={() => { setEditing(!editing); setCampaignSystem(world.system); setAppearance(parseAppearance(world.appearance)); setCoverImage(world.coverImage || ""); setBannerImage(world.bannerImage || ""); setMessage(""); }} disabled={busy}>{editing ? "Cancel" : "Edit world & styling"}</button>
    </div>
    {world.isPublic && <a href={`/w/${world.slug}`} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-indigo-300">Open public world →</a>}
    {message && <p role="status" className="text-sm text-amber-300">{message}</p>}
    {editing ? <form onSubmit={save} className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <section className="space-y-3 rounded-lg border border-zinc-700 p-4"><h2 className="font-semibold">Integrations</h2><p className="text-sm text-zinc-400">Preview and selectively import Foundry VTT Item exports into this world&apos;s compendium.</p><FoundryImport worldId={world.id} onComplete={onRefreshBlocks} onOpenBlock={onOpenBlock} /></section>
      <label className="flex items-center gap-3 text-sm"><input name="isPublic" type="checkbox" defaultChecked={world.isPublic} />Make this world public</label>
      <p className="text-xs text-zinc-400">Public worlds show only articles that are both Published and Public. Turning this off closes public access to the world, its articles and its uploaded images.</p>
      <label className="block">Campaign rules<select aria-label="Campaign rules" name="system" value={campaignSystem} onChange={event => setCampaignSystem(event.target.value)} className="mt-2 block w-full rounded border border-zinc-700 bg-zinc-950 p-3">{RPG_SYSTEMS.map(profile => <option key={profile.id} value={profile.id}>{profile.short}{profile.id === "PF_2E" ? " · Remaster" : ""}</option>)}</select></label>
      <label className="block">World title<input name="title" required maxLength={200} defaultValue={world.title} className="mt-2 block w-full rounded border border-zinc-700 bg-zinc-950 p-3" /></label>
      <label className="block">Description<textarea name="description" maxLength={10000} rows={4} defaultValue={world.description ?? ""} placeholder="Introduce your setting, its magic or technology, and what is happening now." className="mt-2 block w-full rounded border border-zinc-700 bg-zinc-950 p-3" /></label>
      <ImageSourceField worldId={world.id} label="World cover URL" name="coverImage" value={coverImage} onChange={setCoverImage} />
      <p className="text-xs text-zinc-400">Appears on your world homepage. Clear to remove.</p>
      <ImageSourceField worldId={world.id} label="Global article cover URL" name="bannerImage" value={bannerImage} onChange={setBannerImage} />
      <p className="text-xs text-zinc-400">Used when an article has no cover of its own.</p>
      <fieldset disabled={busy} className="space-y-4 rounded-xl border border-zinc-700 p-4">
        <legend className="px-2 font-semibold">Reader appearance</legend>
        <p className="text-xs text-zinc-400">Style your world and article reader pages. The live preview below shows unsaved appearance changes.</p>
        <button type="button" onClick={() => setAppearance({ ...appearance, theme: rulesTheme(campaignSystem), accentColor: "", backgroundColor: "" })} className="rounded-lg border border-amber-700/60 px-3 py-2 text-sm text-amber-200">Use campaign rules style</button>
        <p className="text-xs text-zinc-400">D&D 2014 uses warm parchment, oxblood headings and gold rules. Pathfinder Remaster uses clean pages, deep green headings and compact rulebook statblocks. This button resets accent/background colors to the preset and keeps your background image.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">Theme<select aria-label="World theme" value={appearance.theme} onChange={event => setAppearance({ ...appearance, theme: event.target.value as WorldAppearance["theme"] })} className="mt-2 block w-full rounded border border-zinc-700 bg-zinc-950 p-3">{Object.entries(WORLD_THEMES).map(([key, theme]) => <option key={key} value={key}>{theme.label}</option>)}</select></label>
          <label className="block text-sm">Reading width<select aria-label="Reading width" value={appearance.readingWidth} onChange={event => setAppearance({ ...appearance, readingWidth: event.target.value as WorldAppearance["readingWidth"] })} className="mt-2 block w-full rounded border border-zinc-700 bg-zinc-950 p-3">{Object.keys(READING_WIDTHS).map(key => <option key={key} value={key}>{key[0].toUpperCase() + key.slice(1)}</option>)}</select></label>
          <label className="block text-sm">Page background color<input aria-label="Page background color" type="color" value={appearance.backgroundColor || WORLD_THEMES[appearance.theme].background} onChange={event => setAppearance({ ...appearance, backgroundColor: event.target.value })} className="mt-2 h-10 w-full rounded border border-zinc-700" /></label>
          <label className="block text-sm">Accent color<input aria-label="Accent color" type="color" value={appearance.accentColor || WORLD_THEMES[appearance.theme].accent} onChange={event => setAppearance({ ...appearance, accentColor: event.target.value })} className="mt-2 h-10 w-full rounded border border-zinc-700" /></label>
        </div>
        <ImageSourceField worldId={world.id} label="Page background image URL" value={appearance.backgroundImage} onChange={backgroundImage => setAppearance({ ...appearance, backgroundImage })} />
        <p className="text-xs text-zinc-400">The background sits behind the reading surface and is separate from covers. Accent text is adjusted for readability. Library backgrounds become reader-accessible when the world is public.</p>
        
        {/* Custom CSS Section */}
        <details className="rounded-lg border border-zinc-700">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800">Custom CSS (Advanced)</summary>
          <div className="space-y-3 border-t border-zinc-700 p-4">
            <p className="text-xs text-zinc-400">Add custom styling that only affects your world&apos;s reader pages. Styles are scoped to the reader presentation and cannot affect author controls or other worlds.</p>
            <label className="block">
              <span className="text-xs text-zinc-300">Custom CSS rules</span>
              <textarea
                aria-label="Custom CSS"
                rows={6}
                value={appearance.customCss || ""}
                onChange={event => setAppearance({ ...appearance, customCss: event.target.value || undefined })}
                placeholder={".wf-reader h1 { font-family: 'My Font', serif; }&#10;.wf-reader article { line-height: 1.8; }"}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <p className="text-xs text-zinc-500">Allowed: font properties, colors, spacing, borders. Disallowed: @import, @font-face, fixed positioning, or layout-breaking overrides. Styles targeting .wf-reader are automatically scoped.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAppearance({ ...appearance, customCss: undefined })} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs">Clear custom CSS</button>
            </div>
          </div>
        </details>
        
        <button type="button" onClick={() => setAppearance({ ...DEFAULT_APPEARANCE })} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">Reset appearance to defaults</button>
      </fieldset>
      <button disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save world"}</button>
    </form> : null}
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">{editing ? "Live appearance preview · Save world to apply changes." : "Author preview"}</p>
      <WorldPresentation appearance={editing ? appearance : parseAppearance(world.appearance)} preview>
      <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {/* Remote cover URLs are supplied by the world author. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {(editing ? coverImage : world.coverImage) && <img src={(editing ? coverImage : world.coverImage)!} alt="" className="h-64 w-full object-cover" />}
        <div className="p-8"><p className="mb-3 text-xs uppercase tracking-wider text-amber-500">{systemProfile(world.system).short}{world.system === "PF_2E" ? " · Remaster" : ""}</p><h2 className="font-serif text-4xl font-bold">{world.title}</h2><p className="mt-4 whitespace-pre-wrap text-zinc-300">{world.description || "Give readers a first glimpse of your world. Add a description in world styling."}</p></div>
      </div>
      <div className="rounded-xl border border-zinc-800 p-6">
        <h2 className="text-xl font-semibold">Table of contents</h2>
        <p className="mb-5 mt-1 text-sm text-zinc-400">Author preview · Published articles, including private entries. Selecting an article opens your workspace.</p>
        {published.length ? <ul className="space-y-2">{categoryTree(null)}{articleLinks(null)}</ul> : <p className="text-zinc-400">Publish an article to add it to your world’s table of contents.</p>}
      </div>
      </div>
      </WorldPresentation>
    </div>
  </section>;
}
