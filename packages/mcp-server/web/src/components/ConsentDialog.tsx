import { useState } from "react";
import type { ConsentText } from "../../../src/web/contract";
import infoIcon from "../assets/icon-info.svg";
import { useAcceptConsent } from "../api/queries";
import { t } from "../i18n";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

/**
 * The MCP disclaimer, shown until the current version is accepted. The copy
 * comes from the server (consent/copy.ts) so chat and manager never diverge;
 * it stays English until that file is localised.
 */
export function ConsentDialog({ consent }: { consent: ConsentText }) {
  const [checked, setChecked] = useState(false);
  const accept = useAcceptConsent();
  return (
    <Modal
      width={560}
      title={consent.title}
      icon={<Icon src={infoIcon} size={24} color="var(--text-accent)" />}
    >
      <p className="modal__text t-paragraph-m">{consent.lead}</p>
      <ul className="consent-list t-paragraph-s">
        {consent.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <Checkbox checked={checked} onChange={setChecked}>
        {consent.checkbox}
      </Checkbox>
      {accept.error && <p className="form-error t-body-s">{accept.error.message}</p>}
      <Button block disabled={!checked || accept.isPending} onClick={() => accept.mutate()}>
        {t("consentContinue")}
      </Button>
      <p className="modal__hint t-caption">{t("consentCancelHint")}</p>
    </Modal>
  );
}
