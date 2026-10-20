"use client";

import React from "react";
import { Calendar, Clock, Star, ExternalLink, Bookmark } from "lucide-react";

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
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
          <Clock className="w-4 h-4" />
          <span>Chronicles & Historical Eras</span>
        </div>
        <h2 className="text-2xl font-extrabold text-zinc-100">{timeline.title}</h2>
        {timeline.description && (
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl">{timeline.description}</p>
        )}

        {/* Visual Era Band */}
        <div className="mt-6 pt-4 border-t border-zinc-800 space-y-2">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Epoch Spectrum
          </div>
          <div className="flex w-full h-4 rounded-full overflow-hidden bg-zinc-800">
            {timeline.eras.map((era) => (
              <div
                key={era.id}
                style={{ backgroundColor: era.color, flex: 1 }}
                className="h-full relative group cursor-pointer transition-opacity hover:opacity-80"
                title={`${era.name} (${era.startYear} to ${era.endYear ?? "Present"})`}
              />
            ))}
          </div>

          <div className="flex justify-between text-[11px] text-zinc-500 pt-1">
            {timeline.eras.map((era) => (
              <div key={era.id} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: era.color }} />
                <span className="text-zinc-300 font-medium">{era.name}</span>
                <span className="text-zinc-500">({era.startYear} to {era.endYear ?? "Now"})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Events Stream */}
      <div className="relative pl-6 md:pl-8 border-l-2 border-zinc-800 space-y-8">
        {timeline.events.map((event) => (
          <div key={event.id} className="relative group">
            {/* Timeline Node Point */}
            <div className="absolute -left-[31px] md:-left-[39px] top-1.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-amber-500 ring-4 ring-zinc-950 group-hover:scale-125 transition-transform" />

            <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 shadow-xl hover:border-zinc-700 transition-colors">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    {event.dateDisplay}
                  </span>
                  {event.era && (
                    <span
                      style={{ color: event.era.color }}
                      className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60"
                    >
                      {event.era.name}
                    </span>
                  )}
                </div>

                {/* Importance Rating (Stars) */}
                <div className="flex items-center gap-0.5 text-amber-400" title={`Historical Importance: ${event.importance}/5`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3.5 h-3.5 ${
                        i < event.importance ? "fill-amber-400 text-amber-400" : "text-zinc-700"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <h3 className="text-lg font-bold text-zinc-100">{event.title}</h3>
              <p className="text-sm text-zinc-300 mt-2 leading-relaxed">{event.description}</p>

              {/* Linked Article Card */}
              {event.article && (
                <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs text-zinc-400">Related Article:</span>
                    <span className="text-xs font-semibold text-zinc-200">
                      {event.article.title}
                    </span>
                  </div>

                  {onSelectArticle && (
                    <button
                      onClick={() => onSelectArticle(event.article!.id)}
                      className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
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
