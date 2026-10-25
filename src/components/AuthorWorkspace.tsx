"use client";

import { CommandSearch, SearchCommand } from "@/components/CommandSearch";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AssetLibrary } from "@/components/assets/AssetLibrary";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CategoryManager, CategoryAction } from "@/components/organization/CategoryManager";
import { categoryAncestors } from "@/lib/category-tree";
import { readStoredWorldId, resolveWorldSelection, writeStoredWorldId } from "@/lib/world-selection";
import { applyRegistration, evaluateTransition, type GuardRegistration, type GuardRegistry } from "@/lib/navigation-guard";
import { TreeMove } from "@/components/ArticleTree";
import { BlockStudio } from "@/components/blocks/BlockStudio";
import { CampaignOverview } from "@/components/campaign/CampaignOverview";
import { NextSessionDesk } from "@/components/campaign/NextSessionDesk";
import { BlockCategory, BlockInput, RpgBlockItem } from "@/lib/rpg";
import { WorldHome, WorldSummary } from "@/components/WorldHome";
import { Sidebar } from "@/components/Sidebar";
import { NewWorldForm } from "@/components/worlds/NewWorldForm";
import { WorldGuardProvider } from "@/components/worlds/WorldGuard";
import { ArticleViewer } from "@/components/article/ArticleViewer";
import { ArticleEditorForm } from "@/components/article/ArticleEditorForm";
import type { ArticleSaveInput, ArticleSaveOptions, ArticleSaveResult } from "@/lib/article-save";
import { InteractiveMap, type MapData, type MapMutation } from "@/components/map/InteractiveMap";
import { TimelineViewer } from "@/components/timeline/TimelineViewer";
import { VariableManager } from "@/components/variables/VariableManager";
import { GmNotebook } from "@/components/campaign/GmNotebook";
import { ShareResource } from "@/components/campaign/ShareResource";
import { ArticleDetail, ArticleListItem, ArticleTemplateType, VariableCollectionItem } from "@/types";
import { fetchWorldSnapshot } from "@/lib/workspace-snapshot";
import { loadWorkspaceArticle, saveWorkspaceArticle } from "@/lib/workspace-articles";
import { WorkspaceHistoryCoordinator } from "@/lib/workspace-history";
import { saveWorkspaceMapMutation, saveWorkspaceVariable } from "@/lib/workspace-features";
import { Globe, LogOut, Menu, Users, X } from "lucide-react";

export default function WorldForgeApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [worldSettingsRequest, setWorldSettingsRequest] = useState(0);
  const mainWorkspaceRef = useRef<HTMLElement>(null);
  const mobileNavigationTrigger = useRef<HTMLButtonElement>(null);
  const scrollWorkspaceTo = useCallback((target: HTMLElement) => {
    const pane = mainWorkspaceRef.current;
    if (!pane) return;
    const targetOffset = target.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTo({ top: pane.scrollTop + targetOffset - 16, behavior: "smooth" });
  }, []);
  const closeMobileNavigation = () => {
    setMobileNavigationOpen(false);
    requestAnimationFrame(() => mobileNavigationTrigger.current?.focus());
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [actorId, setActorId] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [world, setWorld] = useState<WorldSummary | null>(null);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [currentArticle, setCurrentArticle] = useState<ArticleDetail | null>(null);
  const [collections, setCollections] = useState<VariableCollectionItem[]>([]);
  const [maps, setMaps] = useState<MapData[]>([]);
  const [timelines, setTimelines] = useState<React.ComponentProps<typeof TimelineViewer>["timeline"][]>([]);
  const [secrets, setSecrets] = useState<React.ComponentProps<typeof GmNotebook>["secrets"]>([]);
  const [rpgBlocks, setRpgBlocks] = useState<RpgBlockItem[]>([]);
  const [sessions, setSessions] = useState<React.ComponentProps<typeof NextSessionDesk>["sessions"]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [editorCategoryId, setEditorCategoryId] = useState<string | null>(null);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const [organizationError, setOrganizationError] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [articleSaving, setArticleSaving] = useState(false);
  const [compendiumCategory, setCompendiumCategory] = useState<BlockCategory | undefined>();
  const [compendiumSession, setCompendiumSession] = useState(0);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const closeButton = document.querySelector<HTMLButtonElement>("#campaign-navigation button[aria-label='Close campaign navigation']:not([tabindex='-1'])");
    closeButton?.focus();
    const getFocusable = () => [...(document.querySelectorAll<HTMLElement>("#campaign-navigation button:not([disabled]), #campaign-navigation a[href], #campaign-navigation input:not([disabled]), #campaign-navigation summary"))].filter(element => element.getClientRects().length > 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavigationOpen(false);
        requestAnimationFrame(() => mobileNavigationTrigger.current?.focus());
        return;
      }
      if (event.key === "Tab") {
        const focusable = getFocusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileNavigationOpen]);

  const [activeView, setActiveView] = useState<
    "home" | "article" | "editor" | "map" | "timeline" | "variables" | "gm" | "blocks" | "manager" | "assets" | "sessions"
  >("home");
  const [editorInitialTemplate, setEditorInitialTemplate] = useState<ArticleTemplateType>("GENERIC");
  const [isLoading, setIsLoading] = useState(true);
  const [worldError, setWorldError] = useState("");
  const [worldUnavailable, setWorldUnavailable] = useState(false);
  // Destination of the most recent failed load (kept until a successful
  // commit) so the error state can offer a real retry of that world.
  const [failedTarget, setFailedTarget] = useState<string | null>(null);

  // A stalled startup request must not leave the workspace on its full-screen
  // loader forever. Once this deadline expires, render the normal recovery
  // state so the user can retry the page load.
  useEffect(() => {
    if (!isLoading || world) return;
    const timeout = window.setTimeout(() => {
      setWorldError("Your campaign is taking longer than expected to open. Check your connection and try again.");
      setIsLoading(false);
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [isLoading, world]);
  const [newWorldOpen, setNewWorldOpen] = useState(false);
  const [creationBusy, setCreationBusy] = useState(false);
  // Shared navigation-guard registry: mounted child forms register their
  // dirty/busy state under stable ids (see src/lib/navigation-guard.ts).
  const [guards, setGuards] = useState<GuardRegistry>(new Map());
  const setGuard = useCallback((id: string, registration: GuardRegistration) => {
    setGuards(previous => applyRegistration(previous, id, registration));
  }, []);
  const guardHandlers = useMemo(() => {
    const make = (id: string) => (registration: GuardRegistration) => setGuard(id, registration);
    return {
      settings: make("settings"),
      compendium: make("compendium"),
      variable: make("variable"),
      map: make("map"),
      session: make("session"),
      asset: make("asset"),
      foundry: make("foundry"),
    };
  }, [setGuard]);
  // In-flight parent writes (uploads and API PATCHes issued outside a child's
  // own busy reporting) block switching until they settle.
  const [writeBusy, setWriteBusy] = useState<ReadonlySet<string>>(new Set());
  const runWrite = useCallback(async <T,>(label: string, task: () => Promise<T>): Promise<T> => {
    setWriteBusy(previous => new Set(previous).add(label));
    try { return await task(); }
    finally {
      setWriteBusy(previous => { const next = new Set(previous); next.delete(label); return next; });
    }
  }, []);
  // Synchronous transition latch: holds the epoch of the in-flight world
  // load (0 = idle). Async callbacks like autosave read this ref instead of
  // possibly-stale state, so no write starts mid-transition, and a superseded
  // load never clears a newer transition's latch.
  const transitionRef = useRef(0);
  const activeLoadController = useRef<AbortController | null>(null);
  const historyCoordinator = useRef<WorkspaceHistoryCoordinator | null>(null);
  if (historyCoordinator.current == null) historyCoordinator.current = new WorkspaceHistoryCoordinator();

  // Prompt-only leave check: busy blocks silently, dirty asks for an explicit
  // discard. It NEVER clears dirty state — callers clear only after a
  // successful commit, so a failed destination load cannot consume the
  // discard confirmation.
  const confirmLeave = useCallback(() => {
    const busyLabels = [
      ...(isLoading && world ? ["world transition"] : []),
      ...(articleSaving ? ["article save"] : []),
      ...(organizationBusy ? ["category writes"] : []),
      ...(creationBusy ? ["world creation"] : []),
      ...writeBusy,
    ];
    const decision = evaluateTransition({ registry: guards, busyLabels, editorDirty });
    if (decision.blocked === "busy") return false;
    if (decision.blocked === "dirty") return window.confirm(decision.message);
    return true;
  }, [guards, editorDirty, articleSaving, organizationBusy, creationBusy, writeBusy, isLoading, world]);

  // Called only after a transition actually committed (view change, switch
  // success, create-and-open success).
  const clearConfirmedLeave = useCallback(() => { setEditorDirty(false); }, []);

  // Refresh the owned-world list when the picker opens; the requested
  // selection is always validated against this authorized list on load.
  const refreshWorlds = useCallback(async () => {
    if (transitionRef.current) return;
    try {
      const response = await fetch("/api/worlds");
      if (response.status === 401) { router.replace("/login"); router.refresh(); throw new Error("Sign in again to refresh worlds."); }
      if (!response.ok) throw new Error("Could not refresh worlds.");
      const list: unknown = await response.json();
      if (!Array.isArray(list)) throw new Error("World list response was invalid.");
      if (!transitionRef.current) setWorlds(list as WorldSummary[]);
    } catch (error) {
      setWorldError(error instanceof Error ? error.message : "Could not refresh worlds.");
      throw error;
    }
  }, [router]);
  // Monotonic load epoch: every world load (initial, switch, retry) takes the
  // next epoch; only the newest epoch may commit state. Reversed network
  // order, aborted loads, late article-detail responses and stale mutation
  // callbacks therefore cannot mix one world's records into another.
  const loadEpoch = useRef(0);
  const worldIdRef = useRef<string | null>(null);
  useEffect(() => { worldIdRef.current = world?.id ?? null; }, [world?.id]);

  // Keep a small index in the existing Next history state. `replaceState`
  // preserves Next's fields, and Next's router remains responsible for URL
  // navigation. The index lets a canceled pop traverse back to the entry the
  // user came from instead of replacing the destination entry.
  useEffect(() => {
    const state = historyCoordinator.current!.initialize(window.history.state);
    if (state) window.history.replaceState(state, "");
    function onPopState(event: PopStateEvent) {
      const destination = new URL(window.location.href).searchParams.get("world");
      const result = historyCoordinator.current!.onPop(event.state, destination, worldIdRef.current, confirmLeave);
      if (result.kind === "cancelled") window.history.go(result.compensation);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [confirmLeave]);

  useEffect(() => {
    const state = historyCoordinator.current!.commitPendingPush(window.history.state);
    if (state) window.history.replaceState(state, "");
  }, [searchParams]);

  const writeUrlForWorld = useCallback((worldId: string | null, options?: { replace?: boolean }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (worldId) params.set("world", worldId); else params.delete("world");
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    // Skip no-op writes so router-driven updates don't retrigger the
    // searchParams selection effect.
    const currentQuery = searchParams.toString();
    const current = currentQuery ? `${pathname}?${currentQuery}` : pathname;
    if (target === current) return;
    if (options?.replace) {
      router.replace(target, { scroll: false });
    } else {
      historyCoordinator.current!.markPush();
      router.push(target, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  // Load the owned-world list, resolve ?world=/stored/default selection
  // against it, then load that world's datasets in parallel.
  // Returns true when the target mounted; false leaves the mounted world,
  // its forms and the URL untouched (callers roll back/picker stays).
  const loadWorld = useCallback(async (targetId: string, owned: WorldSummary[], epoch: number, replaceHistory = false): Promise<boolean> => {
    const target = owned.find(item => item.id === targetId);
    if (!target) {
      if (loadEpoch.current !== epoch) return false;
      // Explicit invalid URLs are a navigation destination. Keep the mounted
      // editor intact unless the same dirty/busy boundary approves leaving it.
      if (worldIdRef.current && !confirmLeave()) return false;
      setFailedTarget(targetId);
      setWorld(null);
      setArticles([]); setCollections([]); setMaps([]); setTimelines([]); setSecrets([]); setRpgBlocks([]); setSessions([]);
      setSelectedArticleId(null); setCurrentArticle(null); setSelectedCategoryId(null);
      setWorldUnavailable(true);
      setWorldError("");
      setIsLoading(false);
      writeUrlForWorld(null, { replace: true });
      return false;
    }
    transitionRef.current = epoch;
    activeLoadController.current?.abort();
    setWorldUnavailable(false);
    setIsLoading(true); setWorldError("");
    const controller = new AbortController();
    activeLoadController.current = controller;
    try {
      const datasets = await fetchWorldSnapshot(target.id, controller.signal);
      if (loadEpoch.current !== epoch) { controller.abort(); return false; }
      const [artList, cols, mapList, timeList, secList, blocks, sessionList] = datasets;
      const replaceHistoryForCommit = replaceHistory || !worldIdRef.current;
      // Commit the new world's complete datasets atomically: reset
      // per-world UI state, then write only this epoch's data.
      setSelectedArticleId(null); setCurrentArticle(null); setSelectedCategoryId(null);
      setEditorCategoryId(null); setEditorDirty(false);
      setGuards(new Map());
      worldIdRef.current = target.id;
      setWorld(target);
      setArticles(artList as ArticleListItem[]);
      setCollections(cols as VariableCollectionItem[]);
      setMaps(mapList as MapData[]);
      setTimelines(timeList as React.ComponentProps<typeof TimelineViewer>["timeline"][]);
      setSecrets(secList as React.ComponentProps<typeof GmNotebook>["secrets"]);
      setRpgBlocks(blocks as RpgBlockItem[]);
      setSessions(sessionList as React.ComponentProps<typeof NextSessionDesk>["sessions"]);
      setWorlds(previous => previous.map(item => item.id === target.id ? target : item));
      historyCoordinator.current!.clearReturnIndex();
      setActiveView("home");
      setWorldError("");
      setFailedTarget(null);
      if (actorId) {
        try { writeStoredWorldId(actorId, target.id, sessionStorage); } catch { /* blocked storage is harmless */ }
      }
      // Successful switches push a history entry so Back returns to the
      // previous world. The initial load replaces to avoid a duplicate entry.
      writeUrlForWorld(target.id, { replace: replaceHistoryForCommit });
      return true;
    } catch (error) {
      if (loadEpoch.current !== epoch || controller.signal.aborted) return false;
      console.error("World load error:", error);
      setFailedTarget(targetId);
      // Failed loads keep the previously mounted world and its state intact;
      // only surface the error when nothing is mounted yet.
      if (!worldIdRef.current) {
        setWorld(null);
        setWorldError("This world could not be loaded. Check your connection and try again.");
      } else {
        setWorldError(`Could not open “${target.title}”. Your current world is unchanged.`);
      }
      return false;
    } finally {
      if (transitionRef.current === epoch) transitionRef.current = 0;
      if (activeLoadController.current === controller) activeLoadController.current = null;
      if (loadEpoch.current === epoch) setIsLoading(false);
    }
  }, [actorId, confirmLeave, writeUrlForWorld]);

  // Initial world list + selection. Back/Forward navigation changes
  // `searchParams`, which re-resolves selection against the authorized list.
  // The mounted world id acts as the loop guard: router URL writes for an
  // already-mounted world are no-ops, and loads only start for a different id.
  const bootstrapped = useRef(false);
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const urlWorldId = searchParams.get("world");
      if (historyCoordinator.current!.shouldSkipCancelledDestination(urlWorldId)) { setIsLoading(false); return; }
      // Already showing exactly what the URL asks for: nothing to do.
      // (Covers the router.replace/push echo after a successful load.)
      if (bootstrapped.current && urlWorldId && urlWorldId === worldIdRef.current) return;
      if (!bootstrapped.current) setIsLoading(true);
      try {
        const [sessionRes, worldsRes] = await Promise.all([fetch("/api/auth/session"), fetch("/api/worlds")]);
        if (cancelled) return;
        if (worldsRes.status === 401 || sessionRes.status === 401) { router.replace("/login"); router.refresh(); return; }
        if (!worldsRes.ok || !sessionRes.ok) throw new Error("Your worlds could not be loaded.");
        const ownedValue: unknown = await worldsRes.json();
        const sessionValue: unknown = await sessionRes.json();
        if (!Array.isArray(ownedValue) || !sessionValue || typeof sessionValue !== "object") throw new Error("Your account response was invalid.");
        const owned = ownedValue as WorldSummary[];
        const actor = (sessionValue as { user?: { id?: string } | null }).user?.id ?? null;
        if (cancelled) return;
        setActorId(actor);
        setWorlds(owned);
        const { selectedId, unknownUrlId } = resolveWorldSelection(owned, {
          urlWorldId,
          storedWorldId: actor ? readStoredWorldId(actor, (() => { try { return sessionStorage; } catch { return null; } })()) : null,
        });
        if (unknownUrlId) {
          if (worldIdRef.current && !historyCoordinator.current!.acceptedDestinationIs(urlWorldId) && !confirmLeave()) {
            setIsLoading(false);
            bootstrapped.current = true;
            return;
          }
          historyCoordinator.current!.clearAcceptedDestination();
          // Explicit URL for a missing/deleted/foreign world: only clear the
          // mounted snapshot after the leave boundary approved the transition.
          ++loadEpoch.current;
          activeLoadController.current?.abort();
          setWorld(null);
          setGuards(new Map());
          setArticles([]); setCollections([]); setMaps([]); setTimelines([]); setSecrets([]); setRpgBlocks([]); setSessions([]);
          setSelectedArticleId(null); setCurrentArticle(null); setSelectedCategoryId(null);
          setWorldUnavailable(true);
          setWorldError("");
          setIsLoading(false);
          bootstrapped.current = true;
          return;
        }
        if (!selectedId) {
          setWorld(null); setWorldUnavailable(false); setWorldError(""); setIsLoading(false);
          writeUrlForWorld(null, { replace: true });
          bootstrapped.current = true;
          return;
        }
        // Back/Forward to the already-mounted world: no reload needed.
        if (selectedId === worldIdRef.current) { historyCoordinator.current!.clearAcceptedDestination(); setIsLoading(false); bootstrapped.current = true; return; }
        // History-driven selection follows the same guard as a user switch:
        // busy blocks silently and a declined discard keeps the current world
        // and its forms intact; restoring the URL re-runs this effect with the
        // mounted world's params, so no navigation loop occurs.
        if (worldIdRef.current && !historyCoordinator.current!.acceptedDestinationIs(urlWorldId) && !confirmLeave()) {
          setIsLoading(false);
          bootstrapped.current = true;
          return;
        }
        const epoch = ++loadEpoch.current;
        bootstrapped.current = true;
        historyCoordinator.current!.clearAcceptedDestination();
        const ok = await loadWorld(selectedId, owned, epoch);
        if (ok) clearConfirmedLeave();
        // On failure the destination URL stays (history entries are never
        // lost); the error state offers an explicit return-to-current action.
      } catch (error) {
        if (!cancelled) { console.error("Initialization error:", error); setWorldError("Your worlds could not be loaded. Check your connection and try again."); setIsLoading(false); }
      }
    }
    bootstrap();
    return () => { cancelled = true; };
    // Re-run when the URL world changes (Back/Forward/explicit links).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Switch worlds: the shared guard runs first (busy blocks, dirty prompts),
  // and dirty state clears only after the destination commits — a failed load
  // cannot consume the discard confirmation. User switches push history only
  // on success, so a failure leaves the mounted world, its forms and the URL
  // untouched and the picker's world list available.
  const requestWorldSwitch = useCallback(async (targetId: string) => {
    if (creationBusy) return false;
    if (!targetId || targetId === worldIdRef.current) return false;
    if (!confirmLeave()) return false;
    const epoch = ++loadEpoch.current;
    const ok = await loadWorld(targetId, worlds, epoch);
    if (ok) { clearConfirmedLeave(); return true; }
    if (loadEpoch.current === epoch && worldIdRef.current) writeUrlForWorld(worldIdRef.current, { replace: true });
    return false;
  }, [clearConfirmedLeave, confirmLeave, creationBusy, loadWorld, worlds, writeUrlForWorld]);

  // A successful creation mounts without another network round-trip when the
  // response already carries the new world's summary; opening retries reuse
  // the guarded loader so a failed open offers retry-opening instead of a
  // duplicate creation. The discard confirmation is consumed only on success.
  const handleWorldCreated = useCallback(async (created: WorldSummary) => {
    setWorlds(previous => previous.some(item => item.id === created.id) ? previous.map(item => item.id === created.id ? created : item) : [...previous, created]);
    const epoch = ++loadEpoch.current;
    const known = worlds.some(item => item.id === created.id) ? worlds : [...worlds, created];
    const ok = await loadWorld(created.id, known, epoch);
    if (!ok) {
      if (loadEpoch.current === epoch && worldIdRef.current) writeUrlForWorld(worldIdRef.current, { replace: true });
      // Keep the dialog open: its confirmed recovery shows "World created;
      // retry opening" rather than inviting another creation.
      throw new Error("World created; retry opening it.");
    }
    clearConfirmedLeave();
    setNewWorldOpen(false);
  }, [clearConfirmedLeave, loadWorld, worlds, writeUrlForWorld]);

  // Choosing "New world" while a creation POST is in flight is disabled by
  // the form itself; the switcher trigger is additionally inert then.
  const openNewWorld = useCallback(() => { if (!creationBusy) setNewWorldOpen(true); }, [creationBusy]);

  // Explicit return-to-current-world action shown when a destination load
  // fails: restores the URL (history-entry for history-driven failures) and
  // dismisses the error without touching the still-mounted forms.
  const returnToCurrentWorld = useCallback(() => {
    if (historyCoordinator.current!.returnOffset !== null) {
      const offset = historyCoordinator.current!.returnOffset!;
      if (offset !== 0) {
        // The history controller accepts the mounted destination when its pop arrives.
        history.go(offset);
      } else if (worldIdRef.current) writeUrlForWorld(worldIdRef.current);
      historyCoordinator.current!.clearReturnIndex();
    } else if (worldIdRef.current) {
      // A failed directly entered URL has no tracked source entry. Push the
      // mounted world as a new entry so the failed destination stays intact.
      writeUrlForWorld(worldIdRef.current);
    }
    setWorldError("");
    setWorldUnavailable(false);
    setFailedTarget(null);
  }, [writeUrlForWorld]);

  // Retry the failed destination when there was one; otherwise reload the
  // mounted world (or the page when nothing could load at all). The guard
  // re-runs because no dirty state was consumed by the failed attempt.
  const retryLoad = useCallback(async () => {
    if (failedTarget && failedTarget !== worldIdRef.current) {
      await requestWorldSwitch(failedTarget);
      return;
    }
    if (worldIdRef.current) {
      if (!confirmLeave()) return;
      const epoch = ++loadEpoch.current;
      if (await loadWorld(worldIdRef.current, worlds, epoch)) clearConfirmedLeave();
      return;
    }
    window.location.reload();
  }, [clearConfirmedLeave, confirmLeave, failedTarget, loadWorld, requestWorldSwitch, worlds]);

  const beforeWorldManagementAction = useCallback(() => !creationBusy && confirmLeave(), [confirmLeave, creationBusy]);
  const completeWorldManagementAction = useCallback((action: "archive" | "duplicate" | "restore" | "purge" | "export" | "import", worldId?: string, summary?: WorldSummary) => {
    if (summary && (action === "duplicate" || action === "import")) {
      setWorlds(previous => previous.some(item => item.id === summary.id) ? previous : [...previous, summary]);
    }
    if (action === "archive" && worldId) {
      const remaining = worlds.filter(item => item.id !== worldId);
      setWorlds(remaining);
      if (worldIdRef.current === worldId) {
        clearConfirmedLeave();
        setWorld(null); setArticles([]); setCollections([]); setMaps([]); setTimelines([]); setSecrets([]); setRpgBlocks([]); setSessions([]);
        setSelectedArticleId(null); setCurrentArticle(null); setSelectedCategoryId(null);
        setWorldUnavailable(false); setWorldError("");
        if (remaining[0]) {
          const epoch = ++loadEpoch.current;
          void loadWorld(remaining[0].id, remaining, epoch, true);
        } else {
          writeUrlForWorld(null, { replace: true });
        }
      }
    }
  }, [clearConfirmedLeave, loadWorld, worlds, writeUrlForWorld]);

  // Fetch full article details when selected; the epoch + world check keeps a
  // late response from world A out of world B.
  useEffect(() => {
    if (!selectedArticleId || !world) return;
    const epoch = loadEpoch.current;
    const worldId = world.id;
    const controller = loadWorkspaceArticle({
      articleId: selectedArticleId,
      worldId,
      epoch,
      isCurrent: (candidateEpoch, candidateWorldId) => loadEpoch.current === candidateEpoch && worldIdRef.current === candidateWorldId,
      setCurrentArticle,
      onError: error => console.error("Failed to load article detail:", error),
    });
    return () => controller.abort();
  }, [selectedArticleId, world]);

  // Prompt-only guard kept under its original name for all transition call
  // sites. It never clears dirty state; callers invoke clearConfirmedLeave()
  // only after their transition actually committed, so a failed world load
  // cannot consume the discard confirmation.
  const canNavigate = useCallback(() => confirmLeave(), [confirmLeave]);
  useEffect(() => {
    if (!editorDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [editorDirty]);

  const handleSelectArticle = (id: string): boolean => {
    if (!canNavigate()) return false;
    clearConfirmedLeave();
    setSelectedArticleId(id);
    setActiveView("article");
    return true;
  };

  const handleNewArticle = (template: ArticleTemplateType = "GENERIC", categoryId: string | null = null): boolean => {
    if (!canNavigate()) return false;
    clearConfirmedLeave();
    setEditorCategoryId(categoryId);
    setSelectedArticleId(null);
    setEditorInitialTemplate(template);
    setCurrentArticle(null);
    setActiveView("editor");
    return true;
  };

  const handleSaveArticle = async (articleData: ArticleSaveInput, options?: ArticleSaveOptions): Promise<ArticleSaveResult> => {
    if (!world) throw new Error("Choose a campaign first.");
    const epoch = loadEpoch.current;
    return saveWorkspaceArticle({
      input: articleData,
      options,
      currentArticle,
      worldId: world.id,
      epoch,
      canStart: () => transitionRef.current === 0,
      isCurrent: (candidateEpoch, candidateWorldId) => loadEpoch.current === candidateEpoch && worldIdRef.current === candidateWorldId,
      setSaving: setArticleSaving,
      setArticles,
      setCurrentArticle,
      setEditorDirty,
      setSelectedArticleId,
      setActiveView,
    });
  };

  const handleUpdateVariable = async (id: string, value: string) => {
    if (!world) throw new Error("Choose a campaign first.");
    const writeWorldId = world.id;
    const epoch = loadEpoch.current;
    await saveWorkspaceVariable(id, value);
    if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return;
    setCollections(previous => previous.map(collection => ({
      ...collection,
      variables: collection.variables.map(variable => variable.id === id ? { ...variable, value } : variable),
    })));
  };

  // Secret reveal, map pins and rules-profile changes have no child-side busy
  // reporting, so the parent registers them; switching waits for their settle.
  const handleToggleSecretReveal = (secretId: string, current: boolean) => runWrite("secret update", async () => {
    if (!world) return;
    const writeWorldId = world.id;
    const epoch = loadEpoch.current;
    try {
      await fetch("/api/secrets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: secretId, isRevealed: !current }),
      });
      // Refresh secrets and current article
      const resSecrets = await fetch(`/api/secrets?worldId=${writeWorldId}`);
      if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return;
      setSecrets(await resSecrets.json());
      if (selectedArticleId) {
        const resArt = await fetch(`/api/articles/${selectedArticleId}`);
        if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return;
        setCurrentArticle(await resArt.json());
      }
    } catch (e) {
      console.error("Secret reveal toggle error:", e);
    }
  });

  const handleMapMutation = (mutation: MapMutation) => runWrite("map edit", async () => {
    if (!world) throw new Error("Choose a campaign first.");
    const writeWorldId = world.id;
    const epoch = loadEpoch.current;
    const { result, maps: refreshedMaps } = await saveWorkspaceMapMutation(writeWorldId, { ...mutation });
    if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return result as Record<string, unknown>;
    if (refreshedMaps) setMaps(refreshedMaps as MapData[]);
    return result as Record<string, unknown>;
  });

  const refreshOrganization = async () => {
    if (!world) return;
    const writeWorldId = world.id;
    const epoch = loadEpoch.current;
    const [categoryResponse, articleResponse] = await Promise.all([fetch(`/api/categories?worldId=${writeWorldId}`), fetch(`/api/articles?worldId=${writeWorldId}`)]);
    if (!categoryResponse.ok || !articleResponse.ok) throw new Error("Unable to reload the article tree. Please try again.");
    const [categories, articleList] = await Promise.all([categoryResponse.json(), articleResponse.json()]);
    if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return;
    setWorld(previous => previous && previous.id === writeWorldId ? { ...previous, categories } : previous);
    setArticles(articleList);
    setCurrentArticle(previous => {
      const item = (articleList as ArticleListItem[]).find(article => article.id === previous?.id);
      return previous && item ? { ...previous, categoryId: item.categoryId, category: item.category, order: item.order } : previous;
    });
  };

  const organize = async (method: string, body: Record<string, unknown>) => {
    if (!world) throw new Error("Choose a world first.");
    setOrganizationBusy(true); setOrganizationError("");
    try {
      const response = await fetch("/api/categories", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, worldId: world.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update the article tree.");
      await refreshOrganization();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update the article tree.";
      setOrganizationError(message); throw new Error(message);
    } finally { setOrganizationBusy(false); }
  };
  const handleTreeMove = (move: TreeMove) => organize("PATCH", { action: move.kind === "category" ? "moveCategory" : "moveArticle", id: move.id, parentId: move.parentId, beforeId: move.beforeId ?? null });
  const handleCategoryAction = (action: CategoryAction) => organize(action.action === "create" ? "POST" : action.action === "delete" ? "DELETE" : "PATCH", action);
  const selectCategory = (id: string | null): boolean => { if (!canNavigate()) return false; clearConfirmedLeave(); setSelectedCategoryId(id); setActiveView("manager"); return true; };

  const handleSaveBlock = async (input: BlockInput) => {
    const writeWorldId = worldIdRef.current;
    const epoch = loadEpoch.current;
    const response = await fetch(input.id ? `/api/statblocks/${input.id}` : "/api/statblocks", {
      method: input.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save statblock.");
    if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return result as RpgBlockItem;
    setRpgBlocks(previous => [...previous.filter(block => block.id !== result.id), result].sort((a, b) => a.name.localeCompare(b.name)));
    return result as RpgBlockItem;
  };

  const handleDeleteBlock = async (id: string) => {
    const writeWorldId = worldIdRef.current;
    const epoch = loadEpoch.current;
    const response = await fetch(`/api/statblocks/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Unable to delete statblock.");
    if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return;
    setRpgBlocks(previous => previous.filter(block => block.id !== id));
  };

  const refreshBlocks = async () => {
    if (!world) return;
    const writeWorldId = world.id;
    const epoch = loadEpoch.current;
    const response = await fetch(`/api/statblocks?worldId=${writeWorldId}`);
    if (!response.ok) throw new Error("Unable to refresh compendium entries.");
    const list = await response.json();
    if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return;
    setRpgBlocks(list);
  };

  const handleRefreshSessions = async () => {
    if (!world) return;
    const writeWorldId = world.id;
    const epoch = loadEpoch.current;
    try {
      const res = await fetch(`/api/worlds/${writeWorldId}/sessions`);
      if (res.ok) {
        const list = await res.json();
        if (loadEpoch.current !== epoch || worldIdRef.current !== writeWorldId) return;
        setSessions(list);
      }
    } catch (e) {
      console.error("Failed to refresh sessions:", e);
    }
  };

  const openCompendium = (category?: BlockCategory): boolean => {
    if (!canNavigate()) return false;
    clearConfirmedLeave();
    setCompendiumCategory(category);
    setCompendiumSession(previous => previous + 1);
    setActiveView("blocks");
    return true;
  };

  const saveWorldSummary = useCallback((saved: WorldSummary) => {
    setWorld(saved);
    setWorlds(previous => previous.map(item => item.id === saved.id ? { ...item, ...saved } : item));
  }, []);

  const isTransitioning = isLoading && !!world;
  const savesPaused = isTransitioning || [...guards].some(([id, registration]) => id.startsWith("world-management:") && registration.busy);
  const mobileViewLabel = activeView === "home" ? "Campaign home"
    : activeView === "article" ? currentArticle?.title || "Article"
      : activeView === "editor" ? "Edit article"
        : ({ map: "Interactive maps", timeline: "Chronicles & timelines", variables: "Variable macros", gm: "GM screen & secrets", blocks: "Bestiary & spellbook", manager: "Articles & categories", assets: "Image library", sessions: "Sessions" } as const)[activeView];
  if (isLoading && !world) {
    // First load (nothing mounted yet): full-screen loader.
    return (
      <div className="w-full h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 space-y-4">
        <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 animate-spin">
          <Globe className="w-6 h-6" />
        </div>
        <p className="text-sm font-semibold tracking-wide">Opening your campaign...</p>
      </div>
    );
  }

  return (
    <div className="author-workspace relative flex h-dvh overflow-hidden bg-[var(--aw-canvas)] font-sans text-zinc-100">
      {/* Keyed by world id: child-local state resets only when a destination
          snapshot commits. During a transition the previous subtree stays
          MOUNTED but inert beneath the loading boundary, so unsaved forms,
          dirty flags and recovery survive a failed load. */}
      <WorldGuardProvider onGuardChange={setGuard} paused={savesPaused}>
      <div key={world?.id ?? "no-world"} className="contents" inert={isTransitioning || undefined}>
      <CommandSearch key={searchOpen ? "open" : "closed"} open={searchOpen} onOpenChange={setSearchOpen} worldId={world?.id} categories={world?.categories || []} onSelectArticle={handleSelectArticle} commands={[
        ...(world?.categories || []).map(category => ({ id: `category-${category.id}`, title: category.name, description: `Category · ${categoryAncestors(world?.categories || [], category.id).map(item => item.name).join(" / ")}`, run: () => selectCategory(category.id) })),
        { id: "new-article", title: "New article", description: "Create an article", run: () => handleNewArticle() },
        ...([ ["home", "Campaign home"], ["manager", "Articles & Categories"], ["assets", "Image library"], ["blocks", "RPG compendium"], ["map", "Maps"], ["timeline", "Timelines"], ["sessions", "Sessions"], ["variables", "Variables"], ["gm", "GM Screen & Secrets"] ] as const).filter(([view]) => view !== "timeline" || timelines.length > 0).map(([view, title]): SearchCommand => ({ id: `tool-${view}`, title, description: "Workspace tool", run: () => { if (view === "blocks") openCompendium(); else if (canNavigate()) { clearConfirmedLeave(); setActiveView(view); } } })),
      ]} />
      {/* Mobile shell controls stay above either the navigation or workspace. */}
      <header inert={mobileNavigationOpen || undefined} className={`fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 px-3 backdrop-blur md:z-50 md:h-16 md:justify-end md:px-5 ${sidebarCollapsed ? "md:left-[68px]" : "md:left-[280px]"}`}>
        <button ref={mobileNavigationTrigger} type="button" aria-label={mobileNavigationOpen ? "Close campaign navigation" : "Open campaign navigation"} aria-expanded={mobileNavigationOpen} aria-controls="campaign-navigation" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 md:hidden" onClick={() => setMobileNavigationOpen(open => !open)}>
          {mobileNavigationOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200 md:hidden" aria-live="polite">{mobileNavigationOpen ? "Campaign navigation" : mobileViewLabel}</p>
        <button type="button" aria-label="Player view" title="Player view" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 md:h-10 md:w-auto md:px-3" onClick={() => { if (!canNavigate()) return; clearConfirmedLeave(); router.push("/player"); }}><Users aria-hidden="true" className="h-4 w-4 md:hidden" /><span className="sr-only md:not-sr-only md:text-sm">Player view</span></button>
        <button type="button" aria-label="Sign out" title="Sign out" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 md:h-10 md:w-auto md:px-3" onClick={async () => { if (!canNavigate()) return; clearConfirmedLeave(); const response = await fetch("/api/auth/logout", { method: "POST" }); if (response.ok) { router.replace("/login"); router.refresh(); } }}><LogOut aria-hidden="true" className="h-4 w-4 md:hidden" /><span className="sr-only md:not-sr-only md:text-sm">Sign out</span></button>
      </header>
      <div id="campaign-navigation" className={`${mobileNavigationOpen ? "fixed inset-0 z-[60] block md:static md:z-auto" : "hidden md:block"} h-full w-full shrink-0 ${sidebarCollapsed ? "md:w-[68px]" : "md:w-[280px]"}`}>
      {mobileNavigationOpen && <button type="button" aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/70 md:hidden" onClick={closeMobileNavigation} />}
      <div className={`relative z-10 h-full ${mobileNavigationOpen ? "w-[min(332px,calc(100vw-58px))]" : "w-full"}`}>
      <Sidebar
        onOpenSearch={() => { setMobileNavigationOpen(false); setSearchOpen(true); }}
        worldTitle={world?.title || "WorldForge"}
        system={world?.system || "DND_5E"}
        articles={articles}
        categories={world?.categories || []}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={id => { if (selectCategory(id)) closeMobileNavigation(); }}
        onMove={handleTreeMove}
        organizationBusy={organizationBusy || activeView === "editor" || (isLoading && !!world)}
        organizationError={organizationError}
        activeView={activeView}
        selectedArticleId={selectedArticleId}
        onSelectArticle={id => { if (handleSelectArticle(id)) closeMobileNavigation(); }}
        onNavigateView={(view) => { const accepted = view === "blocks" ? openCompendium() : canNavigate(); if (view !== "blocks" && accepted) { clearConfirmedLeave(); setActiveView(view); } if (accepted) closeMobileNavigation(); }}
        onNewArticle={template => { if (handleNewArticle(template)) closeMobileNavigation(); }}
        worlds={worlds}
        currentWorldId={world?.id ?? null}
        worldSwitchDisabled={(isLoading && !world) || creationBusy}
        onSelectWorld={id => { void requestWorldSwitch(id).then(accepted => { if (accepted) closeMobileNavigation(); }); }}
        onNewWorld={() => { setMobileNavigationOpen(false); openNewWorld(); }}
        onRefreshWorlds={refreshWorlds}
        actorId={actorId}
        onBeforeManageAction={beforeWorldManagementAction}
        onManageWorld={completeWorldManagementAction}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(value => !value)}
        mobile={mobileNavigationOpen}
        onCloseMobile={closeMobileNavigation}
      />
      </div>
      </div>

      {/* Main Content Workspace */}
      <main ref={mainWorkspaceRef} inert={mobileNavigationOpen || isTransitioning || undefined} aria-hidden={mobileNavigationOpen || undefined} className="mt-14 h-[calc(100dvh-3.5rem)] min-w-0 flex-1 overscroll-contain overflow-y-auto bg-[var(--aw-canvas)] p-4 md:mt-16 md:h-[calc(100dvh-4rem)] md:p-8 lg:p-10">
        <div className="max-w-6xl mx-auto">
          {worldUnavailable && <section aria-live="polite" className="mb-6 rounded-xl border border-amber-800 bg-amber-950/30 p-6">
            <h2 className="text-lg font-semibold text-amber-200">This world isn’t available</h2>
            <p className="mt-1 text-sm text-amber-200/80">It may have been deleted, or the link belongs to another account. Choose one of your worlds to continue.</p>
          </section>}
          {worldError && <p role="alert" className="mb-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            {worldError}
            {world && <button type="button" onClick={returnToCurrentWorld} className="ml-3 underline">Return to {world.title}</button>}
            <button type="button" onClick={() => void retryLoad()} className="ml-3 underline">Try again</button>
          </p>}
          {!world && !worldUnavailable && !worldError && worlds.length === 0 && <section aria-live="polite" className="mx-auto max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
            <p className="text-xs uppercase tracking-widest text-amber-400">Private campaign</p>
            <h2 className="mt-2 font-serif text-3xl text-amber-100">Create your first world</h2>
            <p className="mt-3 text-sm text-zinc-300">New worlds start private and empty. Give yours a title and a rules system to begin your campaign.</p>
            <button type="button" onClick={openNewWorld} className="mt-6 rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-amber-500">Create your first world</button>
          </section>}
          {activeView === "home" && world && <div className="space-y-10">
            <CampaignOverview
              system={world.system}
              worldTitle={world.title}
              worldId={world.id}
              articles={articles}
              blocks={rpgBlocks}
              sessions={sessions}
              onNewArticle={handleNewArticle}
              onSelectArticle={handleSelectArticle}
              onOpenCompendium={openCompendium}
              onOpenGm={() => { if (canNavigate()) { clearConfirmedLeave(); setActiveView("gm"); } }}
              onOpenWorldSettings={() => { if (canNavigate()) { clearConfirmedLeave(); setWorldSettingsRequest(request => request + 1); } }}
              onRefreshSessions={handleRefreshSessions}
            />
            <WorldHome world={world} articles={articles} onSave={saveWorldSummary} onSelectArticle={handleSelectArticle} onRefreshBlocks={refreshBlocks} onGuardChange={guardHandlers.settings} openSettingsRequest={worldSettingsRequest} onScrollToSettings={scrollWorkspaceTo} onOpenBlock={id => { if (!canNavigate()) return; clearConfirmedLeave(); setFocusBlockId(id); setCompendiumCategory(undefined); setCompendiumSession(session => session + 1); setActiveView("blocks"); }} />
          </div>}
          {activeView === "assets" && world && <AssetLibrary worldId={world.id} onGuardChange={guardHandlers.asset} />}
          {activeView === "blocks" && world && <BlockStudio key={`${world.system}-${compendiumSession}`} system={world.system} worldId={world.id} initialCategory={compendiumCategory} focusBlockId={focusBlockId} blocks={rpgBlocks} onSaveBlock={handleSaveBlock} onDeleteBlock={handleDeleteBlock} onRefreshBlocks={refreshBlocks} onGuardChange={guardHandlers.compendium} />}
          {activeView === "manager" && world && <CategoryManager key={selectedCategoryId ?? "root"} categories={world.categories} articles={articles} selectedId={selectedCategoryId} onSelectCategory={setSelectedCategoryId} onSelectArticle={handleSelectArticle} onMove={handleTreeMove} onAction={handleCategoryAction} onNewArticle={handleNewArticle} busy={organizationBusy} error={organizationError} />}
          {/* View: Article Viewer */}
          {activeView === "article" && currentArticle && (
            <div className="space-y-5">
            <ArticleViewer
              system={world?.system}
              publicUrl={world?.isPublic && currentArticle.publicationStatus === "PUBLISHED" && currentArticle.visibility === "PUBLIC" ? `/w/${world.slug}/a/${currentArticle.slug}` : undefined}
              availableArticles={articles}
              article={{ ...currentArticle, coverImage: currentArticle.coverImage || world?.bannerImage, coverImageAlt: currentArticle.coverImage ? currentArticle.coverImageAlt : world?.bannerImageAlt }}
              rpgBlocks={rpgBlocks}
              collections={collections}
              onEdit={() => { if (canNavigate()) { clearConfirmedLeave(); setActiveView("editor"); } }}
              onNavigateArticle={handleSelectArticle}
              onToggleSecretReveal={handleToggleSecretReveal}
            />
            {world && <ShareResource key={currentArticle.id} kind="articles" resourceId={currentArticle.id} title={currentArticle.title} />}
            </div>
          )}

          {/* View: Article Editor */}
          {activeView === "editor" && world && (
            <ArticleEditorForm
              key={currentArticle?.id ?? `new-${editorInitialTemplate}`}
              initialArticle={currentArticle ? currentArticle : { template: editorInitialTemplate, categoryId: editorCategoryId }}
              worldId={world?.id}
              actorId={actorId ?? "local"}
              system={world?.system || "DND_5E"}
              categories={world?.categories || []}
              availableArticles={articles.filter(article => article.id !== currentArticle?.id)}
              variableCollections={collections}
              availableBlocks={rpgBlocks}
              worldPublic={world.isPublic}
              paused={savesPaused}
              isDirty={editorDirty}
              onDirtyChange={setEditorDirty}
              onSave={handleSaveArticle}
              onCancel={() => { if (canNavigate()) { clearConfirmedLeave(); setActiveView(currentArticle ? "article" : "manager"); } }}
            />
          )}

          {/* View: Interactive Maps */}
          {activeView === "map" && world && (
            <div className="space-y-6">
              <InteractiveMap
                maps={maps}
                worldId={world.id}
                articles={articles}
                onSelectArticle={handleSelectArticle}
                onMutate={handleMapMutation}
                onGuardChange={guardHandlers.map}
              />
            </div>
          )}

          {/* View: Chronicles & Timelines */}
          {activeView === "timeline" && timelines.length > 0 && (
            <TimelineViewer
              timeline={timelines[0]}
              onSelectArticle={handleSelectArticle}
            />
          )}

          {/* View: Variable Macros */}
          {activeView === "variables" && (
            <VariableManager
              collections={collections}
              onUpdateVariable={handleUpdateVariable}
              onGuardChange={guardHandlers.variable}
              onCreateVariable={async () => {}}
            />
          )}

          {/* View: GM Screen & Secrets */}
          {activeView === "gm" && (
            <GmNotebook
              system={world?.system || "DND_5E"}
              onOpenCompendium={() => openCompendium()}
              secrets={secrets}
              rpgBlocks={rpgBlocks}
              onToggleSecretReveal={handleToggleSecretReveal}
              onNavigateArticle={handleSelectArticle}
            />
          )}

          {/* View: Sessions */}
          {activeView === "sessions" && world && (
            <div className="max-w-2xl">
              <NextSessionDesk
                worldId={world.id}
                sessions={sessions}
                onRefresh={handleRefreshSessions}
                onGuardChange={guardHandlers.session}
              />
            </div>
          )}
        </div>
      </main>
      </div>
      </WorldGuardProvider>
      {/* Loading boundary above the still-mounted subtree (milestone 4). */}
      {isTransitioning && (
        <div role="status" aria-live="polite" className="fixed inset-0 z-[60] flex flex-col items-center justify-center space-y-4 bg-zinc-950/85 text-zinc-300 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-xl border-2 border-indigo-500/40 border-t-indigo-400" />
          <p className="text-sm font-semibold tracking-wide">Switching worlds…</p>
        </div>
      )}
      {/* New-world modal renders via portal outside settings forms (milestone 3). */}
      {newWorldOpen && actorId && <NewWorldForm
        actorId={actorId}
        defaultSystem={world?.system ?? "DND_5E"}
        onClose={() => { if (!creationBusy) setNewWorldOpen(false); }}
        beforeCreate={async () => {
          // Same guard as switching: creating-and-opening discards nothing
          // without explicit confirmation; declining creates nothing.
          if (!canNavigate()) return false;
          return true;
        }}
        onCreated={handleWorldCreated}
        onBusyChange={setCreationBusy}
      />}
    </div>
  );
}
