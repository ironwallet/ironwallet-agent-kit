/** A transaction the backend estimate returned for the client to sign. */
export interface TransactionToSign {
  transactionId?: string;
  txId?: string;
  txData?: string;
  extraData?: string;
  type?: string;
  value?: string;
  valueEx?: string;
}

/** The signed transaction shape sent back in the forward request. */
export interface SignedTransaction {
  txID: string;
  signature: string;
  txData: string;
  transactionId?: string;
}

export interface SignContext {
  /** 0x-prefixed private key for the network. */
  privateKey: string;
  /** Sender address (network formatted). */
  address: string;
}
