"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import React, { useRef, useState } from "react";
import {
  Variable as VariableIcon,
  Copy,
  Check,
  Save,
  Sparkles,
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
  onGuardChange,
}: VariableManagerProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const pendingIds = useRef(new Set<string>());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  useWorldGuard({ dirty: Object.keys(editingValues).length > 0, busy: savingIds.size > 0 }, "variable", onGuardChange);
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
    if (newVal === undefined || pendingIds.current.has(id)) return;

    pendingIds.current.add(id);
    setSavingIds(new Set(pendingIds.current));
    setSaveErrors(previous => { const next = { ...previous }; delete next[id]; return next; });
    try {
      await onUpdateVariable(id, newVal);
      setEditingValues(previous => { if (previous[id] !== newVal) return previous; const next = { ...previous }; delete next[id]; return next; });
    } catch (error) {
      setSaveErrors(previous => ({ ...previous, [id]: error instanceof Error ? error.message : "Unable to save this variable. Please try again." }));
    } finally {
      pendingIds.current.delete(id);
      setSavingIds(new Set(pendingIds.current));
    }
  };

  const simulatedHtml = interpolateVariables(testText, collections, "text");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-app-surface border border-app-border rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary-400 mb-1">
          <VariableIcon className="w-4 h-4" />
          <span>Dynamic Macro System</span>
        </div>
        <h2 className="text-2xl font-extrabold text-app-text-strong">Global Variable Collections</h2>
        <p className="text-sm text-app-muted mt-1 max-w-3xl leading-relaxed">
          Define global terms, currency names, calendar years, and recurring lore snippets. Use the shortcode{" "}
          <code className="text-primary-300 font-mono text-xs bg-app-raised px-1.5 py-0.5 rounded">[prefix:key]</code>{" "}
          in article text to display canonical values in author views. Saved changes appear in the preview and author article views.
        </p>
      </div>

      {/* Live Interpolation Simulator */}
      <div className="bg-gradient-to-r from-app-surface via-app-surface to-secondary-950/30 border border-secondary-500/30 rounded-xl p-5 shadow-xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-secondary-400">
          <Sparkles className="w-4 h-4" />
          <span>Live Macro Testbench</span>
        </div>

        <div>
          <label className="block text-xs text-app-muted mb-1">Source Text with Shortcodes:</label>
          <input
            type="text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="w-full bg-app-canvas border border-app-border rounded-lg px-3 py-2 text-xs text-app-text font-mono focus:outline-none focus:border-secondary-500"
          />
        </div>

        <div>
          <label className="block text-xs text-app-muted mb-1">Real-Time Interpolated Output:</label>
          <div
            className="w-full min-h-[42px] bg-app-canvas/80 border border-app-border rounded-lg px-3 py-2 text-sm text-app-text flex items-center"
            dangerouslySetInnerHTML={{ __html: simulatedHtml }}
          />
        </div>
      </div>

      {/* Collections Grid */}
      <div className="space-y-6">
        {collections.map((col) => (
          <div
            key={col.id}
            className="bg-app-surface/90 border border-app-border rounded-xl overflow-hidden shadow-xl"
          >
            {/* Collection Title Bar */}
            <div className="p-4 bg-app-surface border-b border-app-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary-500/10 text-primary-400 border border-primary-500/20">
                  prefix: [{col.prefix}]
                </span>
                <div>
                  <h3 className="font-bold text-app-text-strong text-sm">{col.name}</h3>
                  {col.description && (
                    <p className="text-xs text-app-muted mt-0.5">{col.description}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Variables Table */}
            <div className="divide-y divide-app-border/80">
              {col.variables.map((v) => {
                const macro = `[${col.prefix}:${v.key}]`;
                const isCopied = copiedKey === macro;
                const currentValue = editingValues[v.id] !== undefined ? editingValues[v.id] : v.value;

                return (
                  <div
                    key={v.id}
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-app-raised/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyMacro(macro)}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold bg-app-raised hover:bg-app-control-strong text-primary-300 rounded border border-app-border-strong transition-colors group"
                          title="Click to copy macro"
                        >
                          <span>{macro}</span>
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-success-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-app-subtle group-hover:text-app-text-dim" />
                          )}
                        </button>

                        <span className="text-xs font-semibold text-app-text-dim">
                          {v.title || v.key}
                        </span>

                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-app-raised text-app-muted">
                          {v.type}
                        </span>
                      </div>

                      {v.description && (
                        <p className="text-xs text-app-subtle italic">{v.description}</p>
                      )}
                    </div>

                    {/* Value Input & Save Button */}
                    <div className="flex items-center gap-2 w-full md:w-auto">
                      <input
                        type="text"
                        aria-label={`Value for ${macro}`}
                        aria-describedby={saveErrors[v.id] ? `variable-error-${v.id}` : undefined}
                        value={currentValue}
                        onChange={(e) =>
                          setEditingValues((prev) => ({ ...prev, [v.id]: e.target.value }))
                        }
                        className="bg-app-canvas border border-app-border-strong rounded-lg px-3 py-1.5 text-xs text-app-text-strong font-medium focus:outline-none focus:border-primary-500 w-full md:w-64"
                      />

                      <button
                        type="button"
                        onClick={() => handleSave(v.id)}
                        disabled={savingIds.has(v.id) || editingValues[v.id] === undefined}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-app-raised hover:bg-app-control-strong text-app-text disabled:opacity-40 disabled:pointer-events-none transition-colors border border-app-border-strong"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingIds.has(v.id) ? "Saving..." : "Save"}</span>
                      </button>
                    </div>
                    {saveErrors[v.id] && <p id={`variable-error-${v.id}`} role="alert" className="text-xs text-danger-400">{saveErrors[v.id]}</p>}
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
