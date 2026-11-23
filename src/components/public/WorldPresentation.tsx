import type { ReactNode } from "react";
import { appearanceStyles, scopedCustomCss, type WorldAppearance } from "@/lib/world-appearance";

export function WorldPresentation({ appearance, children, preview = false }: { appearance: WorldAppearance; children: ReactNode; preview?: boolean }) {
  const customCss = scopedCustomCss(appearance.customCss || "");
  return (
    <>
      {customCss && <style>{customCss}</style>}
      <div 
        data-world-theme={appearance.theme} 
        data-world-preview={preview || undefined} 
        style={appearanceStyles(appearance)} 
        className={`world-presentation ${preview ? "rounded-xl border border-app-border-strong" : "min-h-screen"} ${!preview ? "wf-reader" : ""}`}
      >
        <div className="world-reading-surface">{children}</div>
      </div>
    </>
  );
}
