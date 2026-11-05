import { useState, type FormEvent } from "react";
import { errorMessage } from "../../api/client";
import { useCreateWallet, useWallets } from "../../api/queries";
import { Button } from "../../components/Button";
import { Notice } from "../../components/Notice";
import { ScreenHeader } from "../../components/ScreenHeader";
import { TextField } from "../../components/TextField";
import { t } from "../../i18n";
import { navigate } from "../../router";
import { defaultWalletName } from "./format";
import { SuccessDialog } from "./SuccessDialog";

export function CreateWalletPage() {
  const wallets = useWallets();
  const create = useCreateWallet();
  const [name, setName] = useState<string | null>(null);
  const value = name ?? (wallets.data ? defaultWalletName(wallets.data.wallets) : "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name: value }, { onSuccess: (r) => setName(r.wallet.name) });
  };

  return (
    <form className="page page--form" onSubmit={submit}>
      <ScreenHeader title={t("createTitle")} />
      <TextField label={t("fieldName")} value={value} onChange={setName} maxLength={40} autoFocus />
      <p className="page__hint t-paragraph-s">{t("createNameHint")}</p>
      <Notice>
        <p>{t("createBackupWarning")}</p>
      </Notice>
      {create.isError && <p className="form-error t-paragraph-s">{errorMessage(create.error)}</p>}
      <div className="button-row">
        <Button variant="secondary" size="m" onClick={() => navigate("wallets")}>
          {t("back")}
        </Button>
        <Button type="submit" size="m" disabled={!value.trim() || create.isPending}>
          {t("createTitle")}
        </Button>
      </div>
      {create.data && (
        <SuccessDialog
          text={t("createdText")}
          walletName={create.data.wallet.name}
          onClose={() => navigate("wallets")}
        />
      )}
    </form>
  );
}
