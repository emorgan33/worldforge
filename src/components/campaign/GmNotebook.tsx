"use client";

import React, { useState } from "react";
import { ShieldAlert, Lock, Unlock, Eye, EyeOff, Sword } from "lucide-react";
import { RpgBlockItem, blockRating, systemProfile } from "@/lib/rpg";
import { StatblockCard } from "@/components/blocks/StatblockCard";

interface SecretItem {
  id: string;
  title: string;
  content: string;
  isRevealed: boolean;
  article?: {
    id: string;
    title: string;
    template: string;
  } | null;
}

interface GmNotebookProps {
  system: string;
  onOpenCompendium: () => void;
  secrets: SecretItem[];
  rpgBlocks: RpgBlockItem[];
  onToggleSecretReveal: (secretId: string, current: boolean) => void;
  onNavigateArticle?: (articleId: string) => void;
}

export function GmNotebook({
  system,
  onOpenCompendium,
  secrets,
  rpgBlocks,
  onToggleSecretReveal,
  onNavigateArticle,
}: GmNotebookProps) {
  const [activeTab, setActiveTab] = useState<"secrets" | "statblocks">("secrets");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const selectedBlock = rpgBlocks.find(block => block.id === selectedBlockId) ?? rpgBlocks.find(block => block.system === system) ?? rpgBlocks[0];

  return (
    <div className="space-y-6">
      {/* GM Header */}
      <div className="bg-gradient-to-r from-app-surface via-app-surface to-danger-950/30 border border-danger-500/30 rounded-xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-danger-400 mb-1">
            <ShieldAlert className="w-4 h-4" />
            <span>{systemProfile(system).gm} campaign workspace</span>
          </div>
          <h2 className="text-2xl font-extrabold text-app-text-strong">{systemProfile(system).gm} Screen & Secrets</h2>
          <p className="text-sm text-app-muted mt-1 max-w-2xl leading-relaxed">
            Prepare campaign revelations and keep your creatures, spells and treasure close at hand.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-app-canvas border border-app-border rounded-lg">
          <button
            onClick={() => setActiveTab("secrets")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === "secrets"
                ? "bg-danger-900/40 text-danger-300 border border-danger-500/30"
                : "text-app-muted hover:text-app-text"
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Secrets Vault ({secrets.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("statblocks")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === "statblocks"
                ? "bg-secondary-900/40 text-secondary-300 border border-secondary-500/30"
                : "text-app-muted hover:text-app-text"
            }`}
          >
            <Sword className="w-3.5 h-3.5" />
            <span>Compendium ({rpgBlocks.length})</span>
          </button>
        </div>
      </div>

      {/* Tab: Secrets Vault */}
      {activeTab === "secrets" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {secrets.map((secret) => (
              <div
                key={secret.id}
                className={`p-5 rounded-xl border shadow-xl flex flex-col justify-between transition-all ${
                  secret.isRevealed
                    ? "bg-app-surface border-primary-500/40"
                    : "bg-app-surface/90 border-danger-500/30"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-app-border">
                    <div className="flex items-center gap-2">
                      {secret.isRevealed ? (
                        <Unlock className="w-4 h-4 text-primary-400" />
                      ) : (
                        <Lock className="w-4 h-4 text-danger-400" />
                      )}
                      <h3 className="font-bold text-sm text-app-text-strong">{secret.title}</h3>
                    </div>

                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        secret.isRevealed
                          ? "bg-primary-500/10 text-primary-400 border border-primary-500/20"
                          : "bg-danger-500/10 text-danger-400 border border-danger-500/20"
                      }`}
                    >
                      {secret.isRevealed ? "Marked revealed (GM only)" : "GM Eyes Only"}
                    </span>
                  </div>

                  <p className="text-xs text-app-text-dim leading-relaxed">{secret.content}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-app-border/80 flex items-center justify-between">
                  {secret.article ? (
                    <button
                      onClick={() => onNavigateArticle && onNavigateArticle(secret.article!.id)}
                      className="text-xs text-secondary-400 hover:text-secondary-300 font-medium truncate max-w-[180px]"
                    >
                      Attached to: {secret.article.title}
                    </button>
                  ) : (
                    <span className="text-xs text-app-subtle">Unattached World Secret</span>
                  )}

                  <button
                    onClick={() => onToggleSecretReveal(secret.id, secret.isRevealed)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                      secret.isRevealed
                        ? "bg-app-raised hover:bg-app-control-strong text-app-text-dim border border-app-border-strong"
                        : "bg-primary-500 hover:bg-primary-400 text-app-on-accent font-semibold shadow-md"
                    }`}
                  >
                    {secret.isRevealed ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Lock Secret</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>Mark revealed (GM only)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "statblocks" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-app-muted">Your campaign compendium</p><button onClick={onOpenCompendium} className="rounded-lg border border-primary-800 px-3 py-2 text-xs text-primary-300">Manage creatures, spells & items</button></div>
          <div className="grid items-start gap-5 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-2">{rpgBlocks.map(block => <button key={block.id} onClick={() => setSelectedBlockId(block.id)} className={`w-full rounded-lg border p-3 text-left ${selectedBlock?.id === block.id ? "border-primary-700 bg-primary-950/20" : "border-app-border bg-app-surface"}`}><span className="block text-sm font-semibold">{block.name}</span><span className="mt-1 block text-xs text-app-muted">{systemProfile(block.system).short} · {blockRating(block)}</span></button>)}</div>
            {selectedBlock ? <StatblockCard block={selectedBlock} /> : <p className="rounded-lg border border-app-border p-8 text-sm text-app-muted">Create a creature, NPC, spell or magic item in the compendium.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
