"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import React, { useState, useEffect, useRef } from "react";
import type { LinkableArticle } from "@/lib/article-links";
import type { JSONContent } from "@tiptap/react";
import { Save, X } from "lucide-react";
import { ArticleDetail, ArticleTemplateType, VariableCollectionItem, CategoryItem } from "@/types";
import { RPG_SYSTEMS, RpgBlockItem } from "@/lib/rpg";
import { publicationFields, type PublicationStatus, type ArticleVisibility } from "@/lib/publication";
import { articleDraftSessionId, articleDraftKey, readArticleDraft, removeArticleDraft } from "@/lib/article-drafts";
import { categoryOptions } from "@/lib/category-tree";
import { ImageSourceField } from "@/components/assets/ImageSourceField";
import { PlacementAltField } from "@/components/assets/PlacementAltField";
import { ArticleTemplateFields } from "./ArticleTemplateFields";
import { isEmptyArticle, starterOutline } from "@/lib/article-template-content";
import { ARTICLE_TEMPLATES, getArticleTemplate, validateTemplateMetadata } from "@/lib/templates";
import { TemplateIcon } from "@/components/TemplateIcon";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { CharacterSheet } from "./CharacterSheet";
import { isCharacterSystem } from "@/lib/character-sheet";
import { ArticleSaveError, type ArticleSaveInput, type ArticleSaveOptions, type ArticleSaveResult } from "@/lib/article-save";

interface ArticleEditorFormProps {
  initialArticle?: Partial<ArticleDetail> | null;
  worldId: string;
  actorId?: string;
  system: string;
  categories: CategoryItem[];
  availableArticles: LinkableArticle[];
  variableCollections: VariableCollectionItem[];
  availableBlocks: RpgBlockItem[];
  worldPublic?: boolean;
  paused?: boolean;
  isDirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onGuardChange?: (registration: { dirty: boolean; busy: boolean } | null) => void;
  onSave: (articleData: ArticleSaveInput, options?: ArticleSaveOptions) => Promise<ArticleSaveResult>;
  onCancel: () => void;
}

export function ArticleEditorForm({
  initialArticle,
  worldId,
  actorId,
  system,
  categories,
  availableArticles,
  variableCollections,
  availableBlocks,
  worldPublic,
  paused = false,
  isDirty,
  onDirtyChange,
  onGuardChange,
  onSave,
  onCancel,
}: ArticleEditorFormProps) {
  const [template, setTemplate] = useState<ArticleTemplateType>(
    initialArticle?.template || "GENERIC"
  );
  const [title, setTitle] = useState(initialArticle?.title || "");
  const [categoryId, setCategoryId] = useState(initialArticle?.categoryId || "");
  const [coverImage, setCoverImage] = useState(initialArticle?.coverImage || "");
  const [coverImageAlt, setCoverImageAlt] = useState<string | null>(initialArticle?.coverImageAlt ?? null);
  const [portraitImage, setPortraitImage] = useState(initialArticle?.portraitImage || "");
  const [portraitImageAlt, setPortraitImageAlt] = useState<string | null>(initialArticle?.portraitImageAlt ?? null);
  const [excerpt, setExcerpt] = useState(initialArticle?.excerpt || "");
  const [tags, setTags] = useState(initialArticle?.tags || "");
  const [state, setState] = useState<PublicationStatus>(initialArticle?.publicationStatus || (initialArticle?.state === "PRIVATE" ? "PUBLISHED" : initialArticle?.state) || "DRAFT");
  const [visibility, setVisibility] = useState<ArticleVisibility>(initialArticle?.visibility || "PRIVATE");
  const [canonState, setCanonState] = useState(initialArticle?.canonState || "GM_DRAFT");
  const [contentHtml, setContentHtml] = useState(initialArticle?.contentHtml || "");

  const [contentJson, setContentJson] = useState<JSONContent | undefined>(() => { try { return initialArticle?.contentJson ? JSON.parse(initialArticle.contentJson) : undefined; } catch { return undefined; } });
  const [saveError, setSaveError] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);

  // Metadata dynamic fields
  const [metadata, setMetadata] = useState<Record<string, string>>(() => {
    if (initialArticle?.metadata) {
      try {
        return JSON.parse(initialArticle.metadata);
      } catch {}
    }
    return {};
  });

  const [articleSystem, setArticleSystem] = useState(metadata.rulesSystem || system);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeTemplateDef = getArticleTemplate(template, articleSystem);

  const handleMetadataChange = (key: string, value: string) => {
    setMetadata((prev) => ({ ...prev, [key]: value }));
  };

  const metadataError = validateTemplateMetadata(activeTemplateDef, metadata, (() => { try { return initialArticle?.metadata ? JSON.parse(initialArticle.metadata) : {}; } catch { return {}; } })());


  const contentSnapshot = useRef<{ html: string; json: JSONContent } | null>(null);
  const articleId = useRef(initialArticle?.id);
  const expectedVersion = useRef(initialArticle?.version);
  const recoveryArticleId = useRef(initialArticle?.id);
  const [draftSessionId, setDraftSessionId] = useState("");
  const draftActorId = actorId ?? "local";
  const draftKey = draftSessionId ? articleDraftKey(draftActorId, worldId, initialArticle?.id, draftSessionId) : "";
  const legacyRecovery = useRef(false);
  const [recovery, setRecovery] = useState<ArticleSaveInput | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const insertOutline = () => {
    if (!activeTemplateDef.starterSections || !isEmptyArticle(contentHtml, contentJson)) return;
    const doc = starterOutline(activeTemplateDef.starterSections);
    setContentJson(doc); setContentHtml(""); contentSnapshot.current = null;
    setEditorVersion(value => value + 1); onDirtyChange(true);
  };
  const [localError, setLocalError] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  const contextPaused = useWorldGuard({ dirty: isDirty || !!recovery, busy: isSubmitting || manualSaving }, "article", onGuardChange);
  const savesPaused = paused || contextPaused;
  const [lastSaved, setLastSaved] = useState(false);
  const inFlight = useRef(false);
  const latest = useRef("");
  const baseline = useRef("");
  const payload: ArticleSaveInput = { worldId, template, title, categoryId: categoryId || null,
    excerpt, tags, ...publicationFields({ publicationStatus: state, visibility }), contentHtml, coverImage, coverImageAlt, ...(contentJson ? { contentJson } : {}),
    portraitImage, portraitImageAlt,
    metadata: { ...metadata, rulesSystem: articleSystem }, canonState };
  const serialized = JSON.stringify(payload);
  useEffect(() => {
    latest.current = serialized;
    if (!baseline.current) baseline.current = serialized;
  }, [serialized]);

  // Recovery synchronizes form state with browser storage after hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      setDraftSessionId(articleDraftSessionId({ getName: () => window.name, setName: value => { window.name = value; } }));
    } catch {
      setLocalError("Unable to identify this tab for draft recovery. Keep this page open until saving succeeds.");
      setDraftSessionId(crypto.randomUUID());
    }
  }, [actorId]);

  useEffect(() => {
    if (!draftActorId) return;
    try {
      // Probe storage here so denied access surfaces a visible warning.
      localStorage.getItem(draftKey);
      const { stored, legacyCopied } = readArticleDraft(localStorage, draftActorId, worldId, initialArticle?.id, draftSessionId);
      if (stored) {
        const draft = stored.draft;
        legacyRecovery.current = stored.source === "legacy" || legacyCopied;
        if (JSON.stringify(draft.data) !== baseline.current) {
          setRecovery(draft.data);
          recoveryArticleId.current = draft.articleId || initialArticle?.id;
        } else removeArticleDraft(localStorage, draftActorId, worldId, initialArticle?.id, { legacy: legacyRecovery.current, sessionId: draftSessionId });
      }
    } catch { setLocalError("Local draft storage is unavailable. Keep this page open until saving succeeds."); }
    setRecoveryReady(true);
  }, [draftKey, draftActorId, worldId, initialArticle?.id]);

  useEffect(() => {
    if (!recoveryReady || recovery) return;
    const dirty = serialized !== baseline.current;
    onDirtyChange(dirty);
    if (!dirty) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ version: 1, articleId: articleId.current, data: { ...JSON.parse(serialized), expectedVersion: expectedVersion.current } }));
      setLocalError("");
    } catch { setLocalError("Unable to keep a local recovery draft. Keep this page open until saving succeeds."); }
  }, [serialized, draftKey, onDirtyChange, recoveryReady, recovery]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = async (autosave: boolean, asNew = false) => {
    if (savesPaused || inFlight.current || recovery || !title.trim() || metadataError) return;
    const snapshot = latest.current;
    inFlight.current = true;
    setIsSubmitting(true);
    setManualSaving(!autosave);
    setSaveError("");
    setSaveConflict(false);
    try {
      const data: ArticleSaveInput = JSON.parse(snapshot);
      data.expectedVersion = asNew ? undefined : expectedVersion.current;
      if (contentSnapshot.current) { data.contentHtml = contentSnapshot.current.html; data.contentJson = contentSnapshot.current.json; }
      const { id, version } = await onSave(data, { autosave, articleId: asNew ? null : articleId.current });
      articleId.current = id;
      expectedVersion.current = version;
      baseline.current = snapshot;
      setLastSaved(true);
      onDirtyChange(latest.current !== snapshot);
      try {
        if (latest.current === snapshot) removeArticleDraft(localStorage, draftActorId, worldId, initialArticle?.id, { legacy: true, sessionId: draftSessionId });
        else localStorage.setItem(draftKey, JSON.stringify({ version: 1, articleId: id, data: { ...JSON.parse(latest.current), expectedVersion: version } }));
      } catch { setLocalError("Unable to update the local recovery draft."); }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save article.");
      setSaveConflict(error instanceof ArticleSaveError);
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
      setManualSaving(false);
    }
  };

  useEffect(() => {
    if (savesPaused || !recoveryReady || recovery || isSubmitting || saveError || serialized === baseline.current || !title.trim() || metadataError) return;
    const timer = setTimeout(() => { void save(true); }, 1500);
    return () => clearTimeout(timer);
    // The serialized snapshot schedules saves; changing callback identity must not restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, recoveryReady, recovery, isSubmitting, saveError, metadataError, savesPaused]);

  const recoverDraft = () => {
    if (!recovery) return;
    articleId.current = recoveryArticleId.current;
    expectedVersion.current = recovery.expectedVersion;
    if (recovery.canonState !== undefined) setCanonState(recovery.canonState);
    setTemplate(recovery.template); setTitle(recovery.title); setCategoryId(recovery.categoryId || "");
    setCoverImage(recovery.coverImage || "");
    setCoverImageAlt(recovery.coverImageAlt ?? null);
    setPortraitImage(recovery.portraitImage || "");
    setPortraitImageAlt(recovery.portraitImageAlt ?? null);
    setExcerpt(recovery.excerpt); setTags(recovery.tags); setState(recovery.publicationStatus || (recovery.state === "PRIVATE" ? "PUBLISHED" : recovery.state)); setVisibility(recovery.visibility || "PRIVATE");
    setContentHtml(recovery.contentHtml); setContentJson(recovery.contentJson);
    setMetadata(recovery.metadata); setArticleSystem(recovery.metadata.rulesSystem || system);
    contentSnapshot.current = null;
    setEditorVersion(value => value + 1); setRecovery(null); onDirtyChange(true);
  };

  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); await save(false); };

  return (
    <form onSubmit={handleSubmit} onChange={() => onDirtyChange(true)} className="space-y-6">
      {recovery && <div role="alert" className="rounded-lg border border-amber-600 p-4 text-sm text-amber-200">
        A local draft is available: {recovery.title || "Untitled article"}. Restore it before continuing, or discard it to use the saved article.
        <button type="button" onClick={recoverDraft} className="ml-3 underline">Restore draft</button>
        <button type="button" onClick={() => { try { removeArticleDraft(localStorage, draftActorId, worldId, initialArticle?.id, { legacy: true, sessionId: draftSessionId }); } catch {} articleId.current = initialArticle?.id; setRecovery(null); }} className="ml-3 underline">Discard draft</button>
      </div>}
      {localError && <p role="alert" className="text-amber-400">{localError}</p>}
      {saveError && <p role="alert" className="text-red-400">{saveError} Changes remain in this editor. <button type="button" onClick={() => void save(true)} className="underline">Retry save</button>{saveConflict && <button type="button" onClick={() => void save(false, true)} className="ml-3 underline">Save as new article</button>}</p>}
      <p role="status" className={`text-xs ${isDirty ? "text-amber-400" : "text-zinc-500"}`}>{metadataError ? "Autosave paused: check template fields" : isSubmitting ? "Saving article…" : saveError ? "Save failed" : isDirty ? title.trim() ? "Changes pending autosave" : "Add a title to enable autosave" : lastSaved ? "All changes saved" : "Autosave on"}</p>
      <fieldset inert={savesPaused || manualSaving || !!recovery || !recoveryReady} disabled={savesPaused || manualSaving || !!recovery || !recoveryReady} className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <TemplateIcon template={template} className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-100">
              {initialArticle?.id ? `Edit: ${initialArticle.title}` : `New ${activeTemplateDef.label}`}
            </h2>
            <p className="text-xs text-zinc-400">{activeTemplateDef.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </button>

          <button
            type="submit"
            disabled={isSubmitting || !!recovery || !recoveryReady || !title.trim() || !!metadataError}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 disabled:opacity-50 transition-all"
          >
            <Save className="w-4 h-4" />
            <span>{isSubmitting ? "Saving..." : "Save Article"}</span>
          </button>
        </div>
      </div>

      {/* Basic Metadata Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Title */}
        {!(template === "CHARACTER" && isCharacterSystem(articleSystem)) && <div className="md:col-span-8">
          <label htmlFor="article-title" className="block text-xs font-semibold text-zinc-300 mb-1">
            Article Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
            id="article-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Thronehold, the Citadel of Glass"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>}

        {/* Template Selector */}
        <div className="md:col-span-4">
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            Template Type
          </label>
          <select
            aria-label="Template type"
            value={template}
            onChange={(e) => setTemplate(e.target.value as ArticleTemplateType)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
          >
            {Object.values(ARTICLE_TEMPLATES).map((tmpl) => (
              <option key={tmpl.type} value={tmpl.type}>
                {tmpl.label}
              </option>
            ))}
          </select>
        </div>

        {/* Excerpt */}
        <div className="md:col-span-8">
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            Summary / Excerpt
          </label>
          <input
            type="text"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Brief 1-2 sentence teaser shown in search and map pin previews..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Category */}
        <div className="md:col-span-4">
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            Folder Category
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">(No Category - Root)</option>
            {categoryOptions(categories).map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="block max-w-sm text-xs font-semibold text-amber-300">Article rules profile<select aria-label="Article rules profile" value={articleSystem} onChange={event => setArticleSystem(event.target.value)} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-200">{RPG_SYSTEMS.map(profile => <option key={profile.id} value={profile.id}>{profile.short}{profile.id === "PF_2E" ? " · Remaster" : ""}</option>)}</select></label>
      {metadataError && <p role="alert" className="text-sm text-red-400">{metadataError} Autosave is paused until this field is corrected.</p>}
      {template === "CHARACTER" && isCharacterSystem(articleSystem) && <CharacterSheet key={articleSystem} system={articleSystem} metadata={metadata} title={title} onChange={handleMetadataChange} onTitleChange={setTitle} />}
      <ArticleTemplateFields template={activeTemplateDef} system={articleSystem} metadata={metadata} blocks={availableBlocks} onChange={handleMetadataChange} />

      <ImageSourceField worldId={worldId} purpose="article-cover" label="Article cover URL" value={coverImage} onChange={setCoverImage} onAssetSelected={asset => { if (coverImageAlt === null && asset.alt) setCoverImageAlt(asset.alt); }} />
      <p className="text-xs text-zinc-500">An article cover overrides the global article cover. Clear it to use the global cover.</p>
      <PlacementAltField id="article-cover-alt" label="Article cover description" value={coverImageAlt} onChange={setCoverImageAlt} fallback={initialArticle?.title || title || undefined} />

      <ImageSourceField worldId={worldId} purpose="portrait" label="Article portrait URL" value={portraitImage} onChange={setPortraitImage} onAssetSelected={asset => { if (portraitImageAlt === null && asset.alt) setPortraitImageAlt(asset.alt); }} />
      <p className="text-xs text-zinc-500">Shown beside the article in the reader sidebar. Clear it to show no portrait.</p>
      <PlacementAltField id="article-portrait-alt" label="Portrait description" value={portraitImageAlt} onChange={setPortraitImageAlt} fallback={initialArticle?.title || title || undefined} />

      {/* Rich Text Editor */}
      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
          Article Lore & Content (TipTap Block Editor)
        </label>
        {activeTemplateDef.starterSections && <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!isEmptyArticle(contentHtml, contentJson)} onClick={insertOutline} className="rounded-lg border border-amber-700/60 px-3 py-2 text-xs text-amber-300 disabled:opacity-40">Insert template outline</button>
          <span className="text-xs text-zinc-500">Adds starter headings to an empty article.</span>
        </div>}
        <TipTapEditor
          worldId={worldId}
          key={editorVersion}
          onSnapshot={snapshot => { contentSnapshot.current = snapshot; }}
          contentHtml={contentHtml}
          contentJson={contentJson ? JSON.stringify(contentJson) : undefined}
          availableBlocks={availableBlocks}
          onChange={(html, json) => { setContentHtml(html); setContentJson(json); onDirtyChange(true); }}
          availableArticles={availableArticles}
          variableCollections={variableCollections}
        />
      </div>

      {/* Tags & Visibility */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-zinc-800">
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1">
            Tags (Comma-separated)
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. capital, high-elf, artifact"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1">
            Publication status
          </label>
          <select
            aria-label="Publication status"
            value={state}
            onChange={(e) => setState(e.target.value as PublicationStatus)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="PUBLISHED">Published</option>
            <option value="WIP">Work in Progress (WIP)</option>
            <option value="DRAFT">Draft</option>

          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1">
            Canon State
          </label>
          <select
            aria-label="Canon state"
            value={canonState}
            onChange={(e) => { setCanonState(e.target.value); onDirtyChange(true); }}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="GM_DRAFT">GM Draft</option>
            <option value="RUMOR">Rumor</option>
            <option value="ESTABLISHED">Established</option>
            <option value="SUPERSEDED">Superseded</option>
          </select>
        </div>
      </div>
      <label className="block text-xs text-zinc-300">Visibility<select aria-label="Article visibility" value={visibility} onChange={event => setVisibility(event.target.value as ArticleVisibility)} className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm"><option value="PRIVATE">Private · owner only</option><option value="PUBLIC">Public · readers can view when published</option></select></label>
      <p className="text-xs text-zinc-400">{!worldPublic ? "This world is private. Its articles remain owner-only, regardless of article visibility." : state === "PUBLISHED" && visibility === "PUBLIC" ? "This article will be available on its public page after saving. GM note blocks and campaign secrets are excluded." : "This article is not publicly readable. Public access requires Published status and Public visibility."}</p>
      </fieldset>
    </form>
  );
}
