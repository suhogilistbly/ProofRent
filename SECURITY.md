# Security Policy

ProofRent is a hackathon MVP, not production financial infrastructure.

## Reporting

Please report security issues privately to the project maintainer. Do not open public issues with private keys, tokens, logs, wallet keypairs, or exploit details.

## In Scope

- Proof issuance and verification logic
- Signature validation
- Replay protection
- Revocation and expiry handling
- Raw financial data exposure in UI, storage, logs, or API responses
- MagicBlock/Solana claim accuracy

## Out of Scope

- Production uptime guarantees
- Mainnet custody or payer key management
- Third-party wallet extension behavior
- Private MagicBlock or RPC provider infrastructure

## Secret Handling

Use `.env.example` as a template only. Real `.env` files, payer keypairs, private keys, access tokens, and seed phrases must never be committed.
