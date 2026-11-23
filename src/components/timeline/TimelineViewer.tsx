"use client";

import React from "react";
import { Clock, Star, ExternalLink, Bookmark } from "lucide-react";

interface EraItem {
  id: string;
  name: string;
  startYear: number;
  endYear?: number | null;
  color: string;
}

interface EventItem {
  id: string;
  title: string;
  dateDisplay: string;
  numericDate: number;
  description: string;
  importance: number;
  articleId?: string | null;
  article?: {
    id: string;
    title: string;
    template: string;
  } | null;
  era?: EraItem | null;
}

interface TimelineViewerProps {
  timeline: {
    id: string;
    title: string;
    description?: string | null;
    eras: EraItem[];
    events: EventItem[];
  };
  onSelectArticle?: (articleId: string) => void;
}

export function TimelineViewer({ timeline, onSelectArticle }: TimelineViewerProps) {
  return (
    <div className="space-y-8">
      {/* Timeline Header */}
      <div className="bg-app-surface border border-app-border rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary-400 mb-1">
          <Clock className="w-4 h-4" />
          <span>Chronicles & Historical Eras</span>
        </div>
        <h2 className="text-2xl font-extrabold text-app-text-strong">{timeline.title}</h2>
        {timeline.description && (
          <p className="text-sm text-app-muted mt-1 max-w-2xl">{timeline.description}</p>
        )}

        {/* Visual Era Band */}
        <div className="mt-6 pt-4 border-t border-app-border space-y-2">
          <div className="text-xs font-semibold text-app-muted uppercase tracking-wider">
            Epoch Spectrum
          </div>
          <div className="flex w-full h-4 rounded-full overflow-hidden bg-app-raised">
            {timeline.eras.map((era) => (
              <div
                key={era.id}
                style={{ backgroundColor: era.color, flex: 1 }}
                className="h-full relative group cursor-pointer transition-opacity hover:opacity-80"
                title={`${era.name} (${era.startYear} to ${era.endYear ?? "Present"})`}
              />
            ))}
          </div>

          <div className="flex justify-between text-[11px] text-app-subtle pt-1">
            {timeline.eras.map((era) => (
              <div key={era.id} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: era.color }} />
                <span className="text-app-text-dim font-medium">{era.name}</span>
                <span className="text-app-subtle">({era.startYear} to {era.endYear ?? "Now"})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Events Stream */}
      <div className="relative pl-6 md:pl-8 border-l-2 border-app-border space-y-8">
        {timeline.events.map((event) => (
          <div key={event.id} className="relative group">
            {/* Timeline Node Point */}
            <div className="absolute -left-[31px] md:-left-[39px] top-1.5 w-4 h-4 rounded-full bg-app-surface border-2 border-primary-500 ring-4 ring-app-canvas group-hover:scale-125 transition-transform" />

            <div className="bg-app-surface/90 border border-app-border rounded-xl p-5 shadow-xl hover:border-app-border-strong transition-colors">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary-500/10 text-primary-400 border border-primary-500/20">
                    {event.dateDisplay}
                  </span>
                  {event.era && (
                    <span
                      style={{ color: event.era.color }}
                      className="text-xs font-semibold px-2 py-0.5 rounded bg-app-raised/80 border border-app-border-strong/60"
                    >
                      {event.era.name}
                    </span>
                  )}
                </div>

                {/* Importance Rating (Stars) */}
                <div className="flex items-center gap-0.5 text-primary-400" title={`Historical Importance: ${event.importance}/5`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3.5 h-3.5 ${
                        i < event.importance ? "fill-primary-400 text-primary-400" : "text-app-faint"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <h3 className="text-lg font-bold text-app-text-strong">{event.title}</h3>
              <p className="text-sm text-app-text-dim mt-2 leading-relaxed">{event.description}</p>

              {/* Linked Article Card */}
              {event.article && (
                <div className="mt-4 pt-3 border-t border-app-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-4 h-4 text-secondary-400" />
                    <span className="text-xs text-app-muted">Related Article:</span>
                    <span className="text-xs font-semibold text-app-text">
                      {event.article.title}
                    </span>
                  </div>

                  {onSelectArticle && (
                    <button
                      onClick={() => onSelectArticle(event.article!.id)}
                      className="flex items-center gap-1 text-xs text-secondary-400 hover:text-secondary-300 transition-colors font-medium"
                    >
                      <span>Read Entry</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
