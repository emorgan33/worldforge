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
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-red-950/30 border border-red-500/30 rounded-xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-400 mb-1">
            <ShieldAlert className="w-4 h-4" />
            <span>{systemProfile(system).gm} campaign workspace</span>
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-100">{systemProfile(system).gm} Screen & Secrets</h2>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
            Prepare campaign revelations and keep your creatures, spells and treasure close at hand.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-zinc-950 border border-zinc-800 rounded-lg">
          <button
            onClick={() => setActiveTab("secrets")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === "secrets"
                ? "bg-red-900/40 text-red-300 border border-red-500/30"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Secrets Vault ({secrets.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("statblocks")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeTab === "statblocks"
                ? "bg-indigo-900/40 text-indigo-300 border border-indigo-500/30"
                : "text-zinc-400 hover:text-zinc-200"
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
                    ? "bg-zinc-900 border-amber-500/40"
                    : "bg-zinc-900/90 border-red-500/30"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                      {secret.isRevealed ? (
                        <Unlock className="w-4 h-4 text-amber-400" />
                      ) : (
                        <Lock className="w-4 h-4 text-red-400" />
                      )}
                      <h3 className="font-bold text-sm text-zinc-100">{secret.title}</h3>
                    </div>

                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        secret.isRevealed
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-red-500/10 text-red-400 border border-red-500/20"
                      }`}
                    >
                      {secret.isRevealed ? "Marked revealed (GM only)" : "GM Eyes Only"}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed">{secret.content}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                  {secret.article ? (
                    <button
                      onClick={() => onNavigateArticle && onNavigateArticle(secret.article!.id)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium truncate max-w-[180px]"
                    >
                      Attached to: {secret.article.title}
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500">Unattached World Secret</span>
                  )}

                  <button
                    onClick={() => onToggleSecretReveal(secret.id, secret.isRevealed)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                      secret.isRevealed
                        ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                        : "bg-amber-500 hover:bg-amber-400 text-black font-semibold shadow-md"
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
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-zinc-400">Your campaign compendium</p><button onClick={onOpenCompendium} className="rounded-lg border border-amber-800 px-3 py-2 text-xs text-amber-300">Manage creatures, spells & items</button></div>
          <div className="grid items-start gap-5 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-2">{rpgBlocks.map(block => <button key={block.id} onClick={() => setSelectedBlockId(block.id)} className={`w-full rounded-lg border p-3 text-left ${selectedBlock?.id === block.id ? "border-amber-700 bg-amber-950/20" : "border-zinc-800 bg-zinc-900"}`}><span className="block text-sm font-semibold">{block.name}</span><span className="mt-1 block text-xs text-zinc-400">{systemProfile(block.system).short} · {blockRating(block)}</span></button>)}</div>
            {selectedBlock ? <StatblockCard block={selectedBlock} /> : <p className="rounded-lg border border-zinc-800 p-8 text-sm text-zinc-400">Create a creature, NPC, spell or magic item in the compendium.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
