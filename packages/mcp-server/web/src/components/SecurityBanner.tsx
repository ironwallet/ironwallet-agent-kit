import { useState } from "react";
import infoRounded from "../assets/icon-info-rounded.svg";
import { t } from "../i18n";
import { AgentInfoDialog } from "./AgentInfoDialog";

export function SecurityBanner() {
  const [open, setOpen] = useState(false);
  return (
    <section className="banner">
      <div className="banner__container">
        <div className="banner__icon">
          <img src={infoRounded} alt="" width={24} height={24} />
        </div>
        <div className="banner__text">
          <p className="banner__title t-button-l">{t("readOnlyTitle")}</p>
          <p className="banner__desc t-paragraph-m">{t("readOnlyText")}</p>
        </div>
        <button type="button" className="banner__details t-button-m" onClick={() => setOpen(true)}>
          {t("details")}
        </button>
      </div>
      {open && <AgentInfoDialog onClose={() => setOpen(false)} />}
    </section>
  );
}
