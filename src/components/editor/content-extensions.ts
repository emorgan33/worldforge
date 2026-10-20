import { ArticleLink } from "./ArticleLink";
import type { LinkableArticle } from "@/lib/article-links";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { CampaignCallout } from "@/lib/editor-nodes";
import { RpgBlockItem } from "@/lib/rpg";
import { StatblockEmbed } from "./StatblockNodeView";

/** The editor and article preview interpret rich blocks using the same schema. */
export function contentExtensions(blocks: RpgBlockItem[], articles: LinkableArticle[] = [], suggestions = false) {
  return [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Image.configure({ allowBase64: false }), TableKit.configure({ table: { resizable: false } }), CampaignCallout, ArticleLink.configure({ articles, suggestions }), StatblockEmbed.configure({ blocks })];
}
