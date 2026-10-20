import { Node, Mark, mergeAttributes } from "@tiptap/core";

export const CampaignCallout = Node.create({
  name: "campaignCallout", group: "block", content: "block+", defining: true, draggable: true,
  addAttributes() { return { kind: { default: "note", parseHTML: element => element.getAttribute("data-callout") || (element.classList.contains("read-aloud-box") ? "readAloud" : element.classList.contains("gm-secret-box") ? "gmNote" : "note"), renderHTML: attributes => ({ "data-callout": attributes.kind }) } }; },
  parseHTML() { return [{ tag: "aside[data-callout]" }, { tag: "div.read-aloud-box" }, { tag: "div.gm-secret-box" }]; },
  renderHTML({ HTMLAttributes }) { return ["aside", mergeAttributes(HTMLAttributes, { class: "campaign-callout" }), 0]; },
});

export const CampaignStatblock = Node.create({
  name: "campaignStatblock", group: "block", atom: true, draggable: true,
  addAttributes() { return {
    blockId: { default: "", parseHTML: element => element.getAttribute("data-statblock-id"), renderHTML: attributes => ({ "data-statblock-id": attributes.blockId }) },
    name: { default: "Statblock", parseHTML: element => element.getAttribute("data-statblock-name") || element.textContent, renderHTML: attributes => ({ "data-statblock-name": attributes.name }) },
  }; },
  parseHTML() { return [{ tag: "section[data-statblock-id]" }]; },
  renderHTML({ node, HTMLAttributes }) { return ["section", mergeAttributes(HTMLAttributes, { class: "campaign-statblock" }), ["p", {}, String(node.attrs.name || "Statblock")]]; },
  renderText({ node }) { return `[block:${node.attrs.blockId}]`; },
});

/** Preserve rendered variable pills and their descriptions in the read-only article view. */
export const PresentationSpan = Mark.create({
  name: "presentationSpan",
  addAttributes() { return { class: { default: null }, title: { default: null } }; },
  parseHTML() { return [{ tag: "span[class]" }, { tag: "span[title]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes), 0]; },
});
