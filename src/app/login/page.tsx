import { AuthForm } from "@/components/auth/AuthForm";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { currentTheme } from "@/lib/theme-server";
export default async function LoginPage() { const theme = await currentTheme(); return <><div className="mx-auto flex w-full max-w-md justify-end p-3"><ThemeSwitcher current={theme} /></div><AuthForm /></>; }
