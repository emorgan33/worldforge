"use client";

import React, { useState } from "react";
import {
  Edit3,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  GitPullRequest,
  Tag,
  Share2,
  Bookmark,
  Check,
} from "lucide-react";
import type { LinkableArticle } from "@/lib/article-links";
import { ArticleDetail, VariableCollectionItem } from "@/types";
import { TemplateIcon } from "@/components/TemplateIcon";
import { ArticleQuickFacts } from "./ArticleQuickFacts";
import { ArticleBody } from "./ArticleBody";
import { RpgBlockItem } from "@/lib/rpg";
import { interpolateVariables } from "@/lib/variable-parser";
import { RulesProfileBadge } from "@/components/blocks/RulesProfileBadge";
import { CanonStateBadge } from "@/components/blocks/CanonStateBadge";
import { CharacterSheet } from "./CharacterSheet";
import { isCharacterSystem } from "@/lib/character-sheet";
import { PLACEMENT_GEOMETRY, resolvePlacementAlt } from "@/lib/image-placement";

interface ArticleViewerProps {
  publicUrl?: string;
  article: ArticleDetail;
  availableArticles: LinkableArticle[];
  rpgBlocks: RpgBlockItem[];
  collections: VariableCollectionItem[];
  onEdit: () => void;
  onNavigateArticle: (articleId: string) => void;
  onToggleSecretReveal: (secretId: string, current: boolean) => void;
  playerView?: boolean;
  system?: string;
}

export function ArticleViewer({
  article,
  publicUrl,
  availableArticles,
  rpgBlocks,
  collections,
  onEdit,
  onNavigateArticle,
  onToggleSecretReveal,
  playerView = false,
  system = "CUSTOM",
}: ArticleViewerProps) {
  const [copiedLink, setCopiedLink] = useState(false);

  // Parse template-specific metadata JSON
  let metadataObj: Record<string, unknown> = {};
  try {
    if (article.metadata) {
      metadataObj = JSON.parse(article.metadata);
    }
  } catch (e) {
    console.error("Failed to parse metadata", e);
  }

  const rulesSystem = typeof metadataObj.rulesSystem === "string" ? metadataObj.rulesSystem : system;


  // Interpolate variables [prefix:key] in the article HTML
  const processedHtml = interpolateVariables(article.contentHtml || "", collections);

  const copyShareLink = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(new URL(publicUrl, window.location.origin).href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Article Cover Banner */}
      {article.coverImage && (
        <div className={PLACEMENT_GEOMETRY["article-cover"].frameClassName}>
          <img
            src={article.coverImage}
            alt={resolvePlacementAlt(article.coverImageAlt, article.title)}
            className={PLACEMENT_GEOMETRY["article-cover"].imageClassName}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-app-canvas via-app-canvas/40 to-transparent" />
        </div>
      )}

      {/* Title & Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-app-border">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {/* Template Badge */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-secondary-500/10 text-secondary-400 border border-secondary-500/20">
              <TemplateIcon template={article.template} className="w-3.5 h-3.5" />
              <span>{article.template}</span>
            </span>

            {/* State/Status Badge - hidden in player view */}
            {!playerView && (
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase ${
                  article.state === "PUBLISHED"
                    ? "bg-success-500/10 text-success-400 border border-success-500/20"
                    : "bg-primary-500/10 text-primary-400 border border-primary-500/20"
                }`}
              >
                {article.publicationStatus || article.state}
              </span>
            )}

            {/* Rules Profile Badge */}
            <RulesProfileBadge system={rulesSystem} size="sm" />

            {/* Canon State Badge - hidden in player view */}
            {!playerView && article.canonState && article.canonState !== "GM_DRAFT" && (
              <CanonStateBadge state={article.canonState} size="sm" />
            )}

            {/* Category */}
            {article.category && (
              <span className="text-xs text-app-muted flex items-center gap-1">
                in <span className="text-app-text font-medium">{article.category.name}</span>
              </span>
            )}

            {!playerView && <span className="text-xs text-app-muted">{article.visibility || "PRIVATE"}</span>}
            <span className="text-xs text-app-subtle">· {article.wordCount} words</span>
          </div>

          <h1 className="text-3xl md:text-4xl font-extrabold text-app-text-strong tracking-tight">
            {article.title}
          </h1>

          {article.excerpt && (
            <p className="text-base text-app-muted mt-2 italic max-w-3xl leading-relaxed">
              &ldquo;{article.excerpt}&rdquo;
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-start md:self-center">
          <button
            onClick={copyShareLink}
            disabled={!publicUrl}
            title={publicUrl ? "Copy public article link" : "Publish with Public visibility in a public world to share"}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-app-surface hover:bg-app-raised text-app-text-dim border border-app-border transition-colors"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-success-400" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copiedLink ? "Copied!" : publicUrl ? "Share" : "Not shared"}</span>
          </button>

          {/* Edit Button - hidden in player view */}
          {!playerView && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-secondary-600 hover:bg-secondary-500 text-white shadow-lg shadow-secondary-600/20 transition-all"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Article</span>
            </button>
          )}
        </div>
      </div>

      {article.template === "CHARACTER" && isCharacterSystem(rulesSystem) && <CharacterSheet system={rulesSystem} metadata={metadataObj} title={article.title} />}
      {/* Main Content Layout (Grid: Content 70% | Metadata Sidebar 30%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Content Body */}
        <div className="lg:col-span-8 space-y-8">
          <article className="max-w-none text-app-text-dim text-base leading-relaxed">
            <ArticleBody key={article.id} html={processedHtml} blocks={rpgBlocks} articles={availableArticles} onNavigateArticle={onNavigateArticle} />
          </article>

          {/* GM Campaign Secrets Section - hidden in player view */}
          {!playerView && article.secrets && article.secrets.length > 0 && (
            <div className="mt-8 pt-6 border-t border-app-border space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-danger-400 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-danger-400" />
                  <span>Confidential GM Campaign Secrets</span>
                </h3>
                <span className="text-xs text-app-subtle">Owner-only tracking · never included on public pages</span>
              </div>

              <div className="space-y-3">
                {article.secrets.map((secret) => (
                  <div
                    key={secret.id}
                    className={`p-4 rounded-xl border transition-all ${
                      secret.isRevealed
                        ? "bg-primary-950/20 border-primary-500/40 text-primary-200"
                        : "bg-danger-950/20 border-danger-500/30 text-app-text-dim"
                    }`}
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-danger-500/20">
                      <div className="font-semibold text-sm text-app-text-strong flex items-center gap-2">
                        {secret.isRevealed ? (
                          <Unlock className="w-4 h-4 text-primary-400" />
                        ) : (
                          <Lock className="w-4 h-4 text-danger-400" />
                        )}
                        <span>{secret.title}</span>
                      </div>

                      <button
                        onClick={() => onToggleSecretReveal(secret.id, secret.isRevealed)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                          secret.isRevealed
                            ? "bg-primary-500/20 hover:bg-primary-500/30 text-primary-300 border border-primary-500/40"
                            : "bg-app-raised hover:bg-app-control-strong text-app-text-dim border border-app-border-strong"
                        }`}
                      >
                        {secret.isRevealed ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Hide Secret</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Mark revealed</span>
                          </>
                        )}
                      </button>
                    </div>

                    <p className="text-xs leading-relaxed">{secret.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bidirectional Mentions Graph */}
          <div className="pt-8 border-t border-app-border grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Outbound References */}
            <div className="bg-app-surface/40 border border-app-border/80 rounded-xl p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-secondary-400 flex items-center gap-1.5 mb-3">
                <GitPullRequest className="w-3.5 h-3.5" />
                <span>References ({article.outboundMentions.length})</span>
              </h4>
              {article.outboundMentions.length === 0 ? (
                <p className="text-xs text-app-subtle italic">No other articles referenced.</p>
              ) : (
                <div className="space-y-2">
                  {article.outboundMentions.map((m) => (
                    <button
                      key={m.targetArticle.id}
                      onClick={() => onNavigateArticle(m.targetArticle.id)}
                      className="w-full text-left p-2 rounded-lg bg-app-surface hover:bg-app-raised border border-app-border transition-colors flex items-center justify-between group"
                    >
                      <span className="text-xs font-medium text-app-text group-hover:text-secondary-400 truncate">
                        {m.targetArticle.title}
                      </span>
                      <span className="text-[10px] text-app-subtle uppercase">
                        {m.targetArticle.template}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Inbound Mentions */}
            <div className="bg-app-surface/40 border border-app-border/80 rounded-xl p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-success-400 flex items-center gap-1.5 mb-3">
                <Bookmark className="w-3.5 h-3.5" />
                <span>Backlinks ({article.inboundMentions.length})</span>
              </h4>
              {article.inboundMentions.length === 0 ? (
                <p className="text-xs text-app-subtle italic">Not mentioned in any other entries yet.</p>
              ) : (
                <div className="space-y-2">
                  {article.inboundMentions.map((m) => (
                    <button
                      key={m.sourceArticle.id}
                      onClick={() => onNavigateArticle(m.sourceArticle.id)}
                      className="w-full text-left p-2 rounded-lg bg-app-surface hover:bg-app-raised border border-app-border transition-colors flex items-center justify-between group"
                    >
                      <span className="text-xs font-medium text-app-text group-hover:text-success-400 truncate">
                        {m.sourceArticle.title}
                      </span>
                      <span className="text-[10px] text-app-subtle uppercase">
                        {m.sourceArticle.template}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Metadata Sidebar (30%) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Portrait Card */}
          {article.portraitImage && (
            <div className="bg-app-surface border border-app-border rounded-xl overflow-hidden shadow-xl p-2">
              <img
                src={article.portraitImage}
                alt={resolvePlacementAlt(article.portraitImageAlt, article.title)}
                className={`${PLACEMENT_GEOMETRY.portrait.imageClassName} rounded-lg border border-app-border`}
              />
            </div>
          )}

          <ArticleQuickFacts template={article.template} system={rulesSystem} metadata={metadataObj} blocks={rpgBlocks} />

          {/* Tags */}
          {article.tags && (
            <div className="bg-app-surface/80 border border-app-border rounded-xl p-4 shadow-xl space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-app-muted flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                <span>World Tags</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {article.tags.split(",").map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-[11px] bg-app-raised text-app-text-dim border border-app-border-strong/60"
                  >
                    #{tag.trim()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
