"use client";

import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { CampaignStatblock } from "@/lib/editor-nodes";
import { RpgBlockItem } from "@/lib/rpg";
import { StatblockCard } from "@/components/blocks/StatblockCard";

function View({ node, extension, selected }: NodeViewProps) {
  const blocks = extension.options.blocks as RpgBlockItem[];
  const block = blocks.find(item => item.id === node.attrs.blockId);
  return <NodeViewWrapper contentEditable={false} className={`campaign-statblock-node my-4 rounded-xl ${selected ? "outline-2 outline-amber-500" : ""}`}>
    {block ? <StatblockCard block={block} /> : <div className="rounded-lg border border-amber-800/50 p-4 text-sm text-zinc-400">{node.attrs.name || "Statblock"} · This compendium entry is unavailable.</div>}
  </NodeViewWrapper>;
}
export const StatblockEmbed = CampaignStatblock.extend<{ blocks: RpgBlockItem[] }>({
  addOptions() { return { blocks: [] }; },
  addNodeView() { return ReactNodeViewRenderer(View); },
});
