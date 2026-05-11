/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_MAGICBLOCK_PER_RPC_URL?: string;
  readonly VITE_MAGICBLOCK_ATTESTATION_URL?: string;
  readonly VITE_MAGICBLOCK_ACCESS_TOKEN_URL?: string;
  readonly VITE_PROOFRENT_PROGRAM_ID?: string;
  readonly VITE_PROOFRENT_TRUSTED_ISSUER?: string;
  readonly VITE_MAGICBLOCK_EXECUTION_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
