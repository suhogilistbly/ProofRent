# ProofRent

ProofRent is a hackathon MVP for privacy-preserving rental applications. Tenants generate a wallet-bound rental proof, landlords verify only the proof surface, and raw income, expense, savings, debt, bank, payroll, and provider records stay out of the landlord review UI.

## Hackathon Context

Built for the MagicBlock Privacy Track. The project demonstrates a MagicBlock-compatible proof execution architecture, real wallet request signatures, real backend proof signatures, backend verification, replay protection, expiry/revocation checks, and optional Solana devnet proof commitments.

## Tech Stack

- React, Vite, TypeScript, Tailwind CSS
- Solana wallet adapter and `@solana/web3.js`
- Express proof service
- Ed25519 signatures with `tweetnacl`
- Optional MagicBlock PER adapter endpoints
- Optional Solana devnet memo/program commitment path

## What Is Real vs Simulated

Real in this MVP:
- Tenant wallet signs proof issuance requests.
- Backend rejects unsigned, invalid, replayed, and expired requests.
- Backend issues signed proofs and signed attestation-style metadata.
- Landlord and public proof pages use backend verification when available.
- Revoked, expired, tampered, and invalid proofs are blocked.
- Optional Solana devnet commitment can submit a real transaction when configured.

Simulated or optional:
- Local demo mode sends plaintext demo financial inputs to the local proof service and labels this as simulation.
- MagicBlock PER is optional. The app only labels a proof as MagicBlock PER when the backend returns `provider = magicblock-per` and `attestationVerified = true`.
- Production TEE/runtime attestation is not claimed unless real MagicBlock endpoints are configured and verified by the backend.

## Privacy Model

The browser collects demo financial inputs to produce a protected proof request. In local simulation mode, those values are sent only to the local proof service and are not stored in app state, localStorage, landlord views, public proof pages, or audit logs. The proof stores sanitized fields: proof ID, wallet, compatible rent range, risk category, validity, expiry, proof hash, issuer, signature, and attestation metadata.

## Setup

Requirements:
- Node.js 20+ recommended
- npm
- Phantom or another Solana wallet with `signMessage` support for wallet flows

Install:

```bash
npm install
```

Configure:

```bash
cp .env.example .env
```

For the default demo, keep MagicBlock and Solana payer values blank. Build and start the backend, then start the frontend in another terminal:

```bash
npm run server:build
npm run server:start
```

```bash
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## Scripts

- `npm run dev` starts the frontend.
- `npm run server:build` builds the backend.
- `npm run server:dev` rebuilds the backend in watch mode.
- `npm run server:start` starts the compiled backend from `dist-server`.
- `npm run typecheck` typechecks frontend and backend.
- `npm run build` builds frontend and backend.
- `npm run test` runs the build and backend proof security tests.
- `npm run preview` serves the production frontend build.

## Demo Flow

1. Open `/` and use `Run judge demo` or `Start private proof`.
2. Pick a property from `/properties`.
3. Connect a wallet and choose a data source.
4. Load the strong profile for approval or risky profile for rejection.
5. Sign the wallet message.
6. Review the proof result. Raw financial values are not shown.
7. Copy the public proof link or open landlord review.
8. In `/landlord`, accept only after backend verification succeeds.
9. After acceptance, contact reveal and handoff method selection unlock.

## Environment Variables

See `.env.example` for all values. Important groups:

- Frontend: `VITE_PROOFRENT_API_URL`, `VITE_SOLANA_RPC_URL`, optional MagicBlock vars.
- Backend: `PROOFRENT_CONFIDENTIAL_PORT`, optional `PROOFRENT_SIGNING_SEED`.
- MagicBlock: `MAGICBLOCK_PER_RPC_URL`, `MAGICBLOCK_ATTESTATION_URL`, `MAGICBLOCK_ACCESS_TOKEN_URL`.
- Solana commitment: `SERVER_SOLANA_RPC_URL`, `SERVER_SOLANA_PAYER_SECRET_KEY`, optional `SERVER_PROOFRENT_PROGRAM_ID`.

Do not commit real secrets, RPC private endpoints, payer keypairs, access tokens, or seed phrases.

## Known Limitations

- Demo financial source connectors are simulated UI choices.
- Local simulation mode is not confidential execution; it is labeled as local plaintext demo mode.
- Public proof lookup from the backend is in-memory and resets when the server restarts.
- Solana commitment is optional and defaults to `not_configured`.
- No production authentication, database, rate limiting, or durable revocation registry is included.

## Security Assumptions

The MVP assumes judges run the frontend and backend locally. Backend-issued signatures are the authority for proof validity. Landlord acceptance requires backend verification. A production deployment would need durable storage, issuer key management, real MagicBlock attestation verification, access control, rate limiting, monitoring, and a deployed Solana verifier or registry program.
