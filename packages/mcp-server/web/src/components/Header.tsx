import { t, type MessageKey } from "../i18n";
import { href, type Route } from "../router";
import { Logo } from "./Logo";
import { ThemeSwitch } from "./ThemeSwitch";

const NAV: { route: Route; label: MessageKey }[] = [
  { route: "home", label: "navHome" },
  { route: "wallets", label: "navWallets" },
  { route: "history", label: "navHistory" },
  { route: "backup", label: "navBackup" },
  { route: "tokens", label: "navTokens" },
];

export function Header({ active }: { active: Route }) {
  return (
    <header className="header">
      <div className="header__container">
        <a className="header__logo" href={href("home")}>
          <Logo variant="header" />
        </a>
        <nav className="header__nav">
          {NAV.map(({ route, label }) => (
            <a
              key={route}
              href={href(route)}
              className={route === active ? "nav-item nav-item--active t-label-m" : "nav-item t-label-m"}
              aria-current={route === active ? "page" : undefined}
            >
              {t(label)}
            </a>
          ))}
        </nav>
        {/* Currency and language controls arrive with the settings stage. */}
        <div className="header__controls">
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
