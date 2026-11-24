import { AuthForm } from "@/components/auth/AuthForm";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { currentTheme } from "@/lib/theme-server";
import { requireRequestTime } from "@/lib/request-time";
export default async function SetupPage() { await requireRequestTime(); const theme = await currentTheme(); return <><div className="mx-auto flex w-full max-w-md justify-end p-3"><ThemeSwitcher current={theme} /></div><AuthForm setup /></>; }
