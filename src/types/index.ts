export type ArticleTemplateType =
  | "CHARACTER"
  | "CREATURE"
  | "ENCOUNTER"
  | "SETTLEMENT"
  | "BUILDING"
  | "LANDMARK"
  | "GEOGRAPHY"
  | "ORGANIZATION"
  | "MILITARY"
  | "SPECIES"
  | "ETHNICITY"
  | "ITEM"
  | "VEHICLE"
  | "TECHNOLOGY"
  | "MATERIAL"
  | "CONDITION"
  | "DOCUMENT"
  | "LAW"
  | "LANGUAGE"
  | "TRADITION"
  | "RITUAL"
  | "MYTH"
  | "SPELL"
  | "PLOT"
  | "REPORT"
  | "PROSE"
  | "GENERIC";

export interface ArticleTemplateMeta {
  type: ArticleTemplateType;
  label: string;
  category: "Entities" | "Places" | "Groups" | "Lore & Culture" | "Rules & Systems" | "Campaign";
  iconName: string;
  description: string;
  starterSections?: string[];
  fields: {
    key: string;
    label: string;
    type: "text" | "number" | "select" | "textarea";
    options?: string[];
    placeholder?: string;
    group?: string;
    min?: number;
    max?: number;
    step?: number;
  }[];
}

export interface VariableItem {
  id: string;
  collectionId: string;
  prefix: string;
  key: string;
  title?: string | null;
  type: "TERM_SIMPLE" | "TERM_ADVANCED" | "RENDERED_FRAGMENT" | "LINK" | "NUMBER";
  value: string;
  description?: string | null;
}

export interface VariableCollectionItem {
  id: string;
  worldId: string;
  name: string;
  prefix: string;
  description?: string | null;
  variables: VariableItem[];
}

export interface CategoryItem {
  id: string;
  worldId: string;
  name: string;
  parentId: string | null;
  order: number;
  icon?: string;
  iconImage?: string | null;
}

export interface ArticleListItem {
  id: string;
  worldId: string;
  categoryId?: string | null;
  template: ArticleTemplateType;
  title: string;
  slug: string;
  excerpt?: string | null;
  state: "DRAFT" | "WIP" | "PUBLISHED" | "PRIVATE";
  publicationStatus?: "DRAFT" | "WIP" | "PUBLISHED";
  visibility?: "PRIVATE" | "PUBLIC";
  isPinned: boolean;
  order: number;
  wordCount: number;
  coverImage?: string | null;
  coverImageAlt?: string | null;
  portraitImage?: string | null;
  portraitImageAlt?: string | null;
  category?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleDetail extends ArticleListItem {
  contentHtml?: string | null;
  contentJson?: string | null;
  sidebarJson?: string | null;
  metadata?: string | null;
  tags?: string | null;
  parentId?: string | null;
  canonState?: string | null;
  parent?: { id: string; title: string; template: ArticleTemplateType } | null;
  children: { id: string; title: string; template: ArticleTemplateType }[];
  outboundMentions: {
    targetArticle: { id: string; title: string; template: ArticleTemplateType; excerpt?: string | null };
  }[];
  inboundMentions: {
    sourceArticle: { id: string; title: string; template: ArticleTemplateType; excerpt?: string | null };
  }[];
  secrets: {
    id: string;
    title: string;
    content: string;
    isRevealed: boolean;
  }[];
}
