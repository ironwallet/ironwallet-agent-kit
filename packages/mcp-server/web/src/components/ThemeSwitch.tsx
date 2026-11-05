import { useEffect, useSyncExternalStore } from "react";
import type { Theme } from "../../../src/web/contract";
import { usePrefs, useUpdatePrefs } from "../api/queries";
import moonIcon from "../assets/icon-moon.svg";
import sunIcon from "../assets/icon-sun.svg";
import { t } from "../i18n";
import { Icon } from "./Icon";

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

function subscribe(onChange: () => void): () => void {
  darkScheme.addEventListener("change", onChange);
  return () => darkScheme.removeEventListener("change", onChange);
}

function osTheme(): Theme {
  return darkScheme.matches ? "dark" : "light";
}

/** Header switch between light and dark; flips the app at once and remembers the choice. */
export function ThemeSwitch() {
  const prefs = usePrefs();
  const update = useUpdatePrefs();
  const os = useSyncExternalStore(subscribe, osTheme);
  // undefined: prefs not loaded yet; null: never picked, the OS scheme applies.
  const saved = update.isPending ? update.variables?.theme : prefs.data?.theme;
  const dark = (saved ?? os) === "dark";

  useEffect(() => {
    if (saved === undefined) return;
    if (saved) document.documentElement.dataset.theme = saved;
    else delete document.documentElement.dataset.theme;
  }, [saved]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t("darkTheme")}
      className={dark ? "theme-switch theme-switch--dark" : "theme-switch"}
      onClick={() => update.mutate({ theme: dark ? "light" : "dark" })}
    >
      <span className="theme-switch__knob">
        <Icon src={dark ? moonIcon : sunIcon} size={16} color="var(--text-accent)" />
      </span>
    </button>
  );
}
