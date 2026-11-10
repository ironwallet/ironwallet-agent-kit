import { t } from "../i18n";
import { href } from "../router";
import { Logo } from "./Logo";

const SITE = "https://ironwallet.io";

function External({ path, children }: { path: string; children: string }) {
  return (
    <a href={`${SITE}${path}`} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__container">
        <div className="footer__top">
          <div className="footer__brand">
            <Logo variant="footer" />
            <p className="footer__tagline">{t("footerTagline")}</p>
          </div>
          <div className="footer__columns">
            <div className="footer__column">
              <p className="footer__heading">{t("footerProduct")}</p>
              <a href={href("wallets")}>{t("navWallets")}</a>
              <a href={href("history")}>{t("navHistory")}</a>
              <a href={href("backup")}>{t("navBackup")}</a>
            </div>
            <div className="footer__column">
              <p className="footer__heading">{t("footerCompany")}</p>
              <External path="/legal-enquiries/">{t("footerLegalEnquiries")}</External>
            </div>
          </div>
        </div>
        <div className="footer__bottom">
          <p className="footer__copyright">{t("footerCopyright", { year: new Date().getFullYear() })}</p>
          <div className="footer__legal">
            <External path="/privacy-policy/">{t("footerPrivacy")}</External>
            <External path="/terms-and-conditions/">{t("footerTerms")}</External>
          </div>
        </div>
      </div>
    </footer>
  );
}
