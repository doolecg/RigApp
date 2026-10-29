import { useEffect } from "react";
import type { Settings } from "@rigapp/contracts";
import { useMedia } from "./ui";

/** Whether the light theme is showing: the Settings choice, or the system's when that is "system". */
export function useLight(theme: Settings["theme"] | undefined): boolean {
  const systemLight = useMedia("(prefers-color-scheme: light)");
  return theme === "light" || (theme !== "dark" && systemLight);
}

/** Puts the Settings choice on <html>, where the colour tokens in index.css read it. */
export function useThemeAttribute(theme: Settings["theme"] | undefined) {
  useEffect(() => {
    if (!theme || theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
}
