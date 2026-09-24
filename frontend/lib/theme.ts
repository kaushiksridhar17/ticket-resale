import type { Theme } from "./types";

const STORAGE_KEY = "facevalue-theme";

export const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }

  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // private browsing, or storage turned off
  }
}

// Runs before the first paint so the page does not start in the wrong
// theme and switch once the account has loaded.
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;
