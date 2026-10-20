"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import React, { useState } from "react";
import {
  Variable as VariableIcon,
  Copy,
  Check,
  Plus,
  Save,
  Sparkles,
  Info,
} from "lucide-react";
import { VariableCollectionItem } from "@/types";
import { interpolateVariables } from "@/lib/variable-parser";

interface VariableManagerProps {
  collections: VariableCollectionItem[];
  onUpdateVariable: (id: string, value: string) => Promise<void>;
  onCreateVariable: (collectionId: string, key: string, value: string, type: string) => Promise<void>;
  onGuardChange?: (registration: { dirty: boolean; busy: boolean } | null) => void;
}

export function VariableManager({
  collections,
  onUpdateVariable,
  onCreateVariable,
  onGuardChange,
}: VariableManagerProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useWorldGuard({ dirty: Object.keys(editingValues).length > 0, busy: savingId !== null }, "variable", onGuardChange);
  const [testText, setTestText] = useState(
    "In the year [cal:current_year], travelers across [lore:world_name] exchanged [coin:gold] to purchase skyship passage."
  );

  const copyMacro = (macro: string) => {
    navigator.clipboard.writeText(macro);
    setCopiedKey(macro);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSave = async (id: string) => {
    const newVal = editingValues[id];
    if (newVal === undefined) return;

    setSavingId(id);
    try {
      await onUpdateVariable(id, newVal);
      setEditingValues(previous => { if (previous[id] !== newVal) return previous; const next = { ...previous }; delete next[id]; return next; });
    } finally {
      setSavingId(null);
    }
  };

  const simulatedHtml = interpolateVariables(testText, collections);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
          <VariableIcon className="w-4 h-4" />
          <span>Dynamic Macro System</span>
        </div>
        <h2 className="text-2xl font-extrabold text-zinc-100">Global Variable Collections</h2>
        <p className="text-sm text-zinc-400 mt-1 max-w-3xl leading-relaxed">
          Define global terms, currency names, calendar years, and recurring lore snippets. Use the shortcode{" "}
          <code className="text-amber-300 font-mono text-xs bg-zinc-800 px-1.5 py-0.5 rounded">[prefix:key]</code>{" "}
          anywhere in articles to inject or link canonical values. When you change a value here, it updates throughout your world instantly!
        </p>
      </div>

      {/* Live Interpolation Simulator */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-indigo-950/30 border border-indigo-500/30 rounded-xl p-5 shadow-xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-400">
          <Sparkles className="w-4 h-4" />
          <span>Live Macro Testbench</span>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Source Text with Shortcodes:</label>
          <input
            type="text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Real-Time Interpolated Output:</label>
          <div
            className="w-full min-h-[42px] bg-zinc-950/80 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 flex items-center"
            dangerouslySetInnerHTML={{ __html: simulatedHtml }}
          />
        </div>
      </div>

      {/* Collections Grid */}
      <div className="space-y-6">
        {collections.map((col) => (
          <div
            key={col.id}
            className="bg-zinc-900/90 border border-zinc-800 rounded-xl overflow-hidden shadow-xl"
          >
            {/* Collection Title Bar */}
            <div className="p-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  prefix: [{col.prefix}]
                </span>
                <div>
                  <h3 className="font-bold text-zinc-100 text-sm">{col.name}</h3>
                  {col.description && (
                    <p className="text-xs text-zinc-400 mt-0.5">{col.description}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Variables Table */}
            <div className="divide-y divide-zinc-800/80">
              {col.variables.map((v) => {
                const macro = `[${col.prefix}:${v.key}]`;
                const isCopied = copiedKey === macro;
                const currentValue = editingValues[v.id] !== undefined ? editingValues[v.id] : v.value;

                return (
                  <div
                    key={v.id}
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-zinc-800/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyMacro(macro)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold bg-zinc-800 hover:bg-zinc-700 text-amber-300 rounded border border-zinc-700 transition-colors group"
                          title="Click to copy macro"
                        >
                          <span>{macro}</span>
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300" />
                          )}
                        </button>

                        <span className="text-xs font-semibold text-zinc-300">
                          {v.title || v.key}
                        </span>

                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {v.type}
                        </span>
                      </div>

                      {v.description && (
                        <p className="text-xs text-zinc-500 italic">{v.description}</p>
                      )}
                    </div>

                    {/* Value Input & Save Button */}
                    <div className="flex items-center gap-2 w-full md:w-auto">
                      <input
                        type="text"
                        value={currentValue}
                        onChange={(e) =>
                          setEditingValues((prev) => ({ ...prev, [v.id]: e.target.value }))
                        }
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-medium focus:outline-none focus:border-amber-500 w-full md:w-64"
                      />

                      <button
                        type="button"
                        onClick={() => handleSave(v.id)}
                        disabled={savingId === v.id || editingValues[v.id] === undefined}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:pointer-events-none transition-colors border border-zinc-700"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingId === v.id ? "Saving..." : "Save"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
