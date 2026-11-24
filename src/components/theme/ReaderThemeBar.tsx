import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { currentTheme } from "@/lib/theme-server";

/**
 * Theme control for reader and player chrome. Server-rendered so the control
 * reflects the same resolved theme as <html>, without a client-side read.
 */
export async function ReaderThemeBar({ className = "" }: { className?: string }) {
  const theme = await currentTheme();
  return (
    <div className={`flex justify-end bg-app-canvas px-3 pt-3 ${className}`}>
      <ThemeSwitcher current={theme} />
    </div>
  );
}
