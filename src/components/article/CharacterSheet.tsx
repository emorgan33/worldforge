"use client";

import { useId, useRef, useState } from "react";
import {
  characterRowsKey, characterSheetDefinition, dndAbilityModifier, readCharacterRows, updateCharacterRows,
  type CharacterSystem, type SheetField, type SheetRowSection, type CharacterRow,
} from "@/lib/character-sheet";
import styles from "./CharacterSheet.module.css";

type Change = (key: string, value: string) => void;

function SheetValue({ field, value, onChange, label, modifier }: { field: SheetField; value: unknown; onChange?: (value: string) => void; label?: string; modifier?: string }) {
  const id = useId();
  const text = typeof value === "string" ? value : "";
  const accessibleLabel = label || field.label;
  const invalidNumber = field.type === "number" && !!text && (!Number.isInteger(Number(text)) || (field.min !== undefined && Number(text) < field.min) || (field.max !== undefined && Number(text) > field.max));
  return <div className={`${styles.field} ${field.type === "textarea" ? styles.wide : ""}`}>
    {onChange ? <label htmlFor={id}>{field.label}</label> : <span className={styles.label}>{field.label}</span>}
    {!onChange ? <div className={styles.readValue}>{field.type === "checkbox" ? (text === "true" ? "✓ Yes" : "—") : text || <span aria-label="Not filled in">—</span>}</div>
      : field.type === "checkbox" ? <input id={id} type="checkbox" aria-label={accessibleLabel} checked={text === "true"} onChange={event => onChange(String(event.target.checked))} />
      : field.type === "select" ? <select id={id} aria-label={accessibleLabel} value={text} onChange={event => onChange(event.target.value)}>
        <option value="">—</option>
        {text && !field.options?.includes(text) && <option value={text}>{text} (saved)</option>}
        {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      : field.type === "textarea" ? <textarea id={id} aria-label={accessibleLabel} rows={2} value={text} onChange={event => onChange(event.target.value)} />
      : <input id={id} aria-label={accessibleLabel} type={invalidNumber ? "text" : field.type} min={field.min} max={field.max} step={field.step} value={text} onChange={event => onChange(event.target.value)} />}
    {invalidNumber && onChange && <small className={styles.legacy}>Saved text retained; enter a whole number to update.</small>}
    {modifier !== undefined && <div className={styles.modifier}><span>Modifier</span> <output aria-label={`${field.label.replace(" score", "")} modifier`}>{modifier}</output></div>}
  </div>;
}

function RepeatingSection({ section, rows, onChange }: { section: SheetRowSection; rows: CharacterRow[]; onChange?: (rows: CharacterRow[]) => void }) {
  const root = useRef<HTMLElement>(null);
  const [removed, setRemoved] = useState<{ row: CharacterRow; index: number } | null>(null);
  const add = () => {
    onChange?.([...rows, { id: crypto.randomUUID() }]);
    requestAnimationFrame(() => {
      const entries = root.current?.querySelectorAll<HTMLElement>("[data-sheet-row]");
      entries?.[entries.length - 1]?.querySelector<HTMLInputElement>("input")?.focus();
    });
  };
  return <section ref={root} className={`${styles.section} ${styles.wide}`} aria-label={section.name}>
    <h3>{section.name}</h3>
    <div className={styles.sectionBody}>
      {rows.length ? rows.map((row, index) => <div key={row.id} className={styles.row} data-sheet-row>
        <div className={styles.rowFields}>{section.columns.map(field => <SheetValue key={field.key} field={field} value={row[field.key]} label={`${section.singular} ${index + 1} ${field.label}`} onChange={onChange ? value => onChange(rows.map(item => item.id === row.id ? { ...item, [field.key]: value } : item)) : undefined} />)}</div>
        {onChange && <button type="button" className={styles.remove} aria-label={`Remove ${section.singular} ${index + 1}`} onClick={() => { setRemoved({ row, index }); onChange(rows.filter(item => item.id !== row.id)); }}>Remove</button>}
      </div>) : <div className={styles.emptyRows}>
        <div className={styles.emptyColumns}>{section.columns.map(field => <span key={field.key}>{field.label}</span>)}</div>
        <p>{onChange ? `Add a ${section.singular} to fill in this section.` : "No entries recorded."}</p>
      </div>}
      {onChange && <div className={styles.rowActions}>
        <button type="button" onClick={add}>+ Add {section.singular}</button>
        {removed && <span role="status">Entry removed. <button type="button" onClick={() => {
          const restored = [...rows]; restored.splice(Math.min(removed.index, rows.length), 0, removed.row); onChange(restored); setRemoved(null);
        }}>Undo removal</button></span>}
      </div>}
    </div>
  </section>;
}

/** The editor and readers use the same layout; absence of onChange renders plain text. */
export function CharacterSheet({ system, metadata, title, onChange, onTitleChange }: {
  system: CharacterSystem; metadata: Record<string, unknown>; title: string; onChange?: Change; onTitleChange?: (title: string) => void;
}) {
  const definition = characterSheetDefinition(system);
  const rowKey = characterRowsKey(system);
  const { data, error } = readCharacterRows(metadata[rowKey]);
  const pf = system === "PF_2E";
  const section = (name: string, className = "") => {
    const group = definition.sections.find(item => item.name === name)!;
    return <section className={`${styles.section} ${className}`} aria-label={name}>
      <h3>{name}</h3>
      <div className={`${styles.sectionBody} ${styles.fields} ${name === "Skills" || name === "Saving throws" || name === "Spell slots" ? styles.paired : ""}`}>
        {group.fields.map(field => <SheetValue key={field.key} field={field} value={metadata[field.key]} modifier={name === "Ability scores" ? dndAbilityModifier(metadata[field.key]) : undefined} onChange={onChange ? value => onChange(field.key, value) : undefined} />)}
      </div>
    </section>;
  };
  const rowSection = (key: string) => {
    const spec = definition.rows.find(item => item.key === key)!;
    return <RepeatingSection key={`${system}-${key}`} section={spec} rows={data.sections[key] || []} onChange={onChange && !error ? rows => onChange(rowKey, updateCharacterRows(data, key, rows)) : undefined} />;
  };
  return <div className={styles.container}>
    <section className={`${styles.sheet} ${pf ? styles.pathfinder : ""}`} aria-label={`${pf ? "Pathfinder 2e Remaster" : "D&D 5e 2014"} character sheet`}>
      <header className={styles.header}>
        <div><p className={styles.edition}>{pf ? "Pathfinder · Second Edition Remaster" : "Dungeons & Dragons · Fifth Edition 2014"}</p><h2>Character sheet</h2></div>
        {onTitleChange ? <label className={styles.name}>Character name<input aria-label="Character name" required value={title} onChange={event => onTitleChange(event.target.value)} placeholder="Name your character" /></label> : <p className={styles.characterName}>{title || "Unnamed character"}</p>}
      </header>
      {onChange && <p className={styles.guidance}>Fill in the boxes as you would a paper sheet. Enter final totals; changes save with this article.</p>}
      <div className={styles.layout}>
        {section("Identity", styles.wide)}
        {section(pf ? "Attribute modifiers" : "Ability scores", `${styles.wide} ${styles.abilities}`)}
        <div className={styles.column}>
          {section("Saving throws")}
          {section("Skills")}
          {pf && rowSection("lore")}
        </div>
        <div className={styles.mainColumn}>
          {section("Defenses & movement")}
          {section("Hit points & resources")}
          {rowSection("attacks")}
          {rowSection("resources")}
        </div>
        {rowSection("equipment")}
        {section("Equipment notes", styles.wide)}
        {rowSection("features")}
        {section("Spellcasting", styles.wide)}
        {section("Spell slots", styles.wide)}
        {rowSection("spells")}
        {section("Personality & appearance", styles.wide)}
      </div>
      {error && onChange && <div role="alert" className={styles.error}>{error}<details><summary>View preserved row data</summary><pre>{String(metadata[rowKey])}</pre></details></div>}
      <footer className={styles.footer}>{pf ? "PF2e Remaster · Attribute modifiers · Spell ranks" : "D&D 2014 · Ability scores · Spell levels"}</footer>
    </section>
  </div>;
}
