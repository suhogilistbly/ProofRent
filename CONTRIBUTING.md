# Contributing

Thanks for helping harden ProofRent.

## Local Development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and keep real secrets out of git.
3. Build the backend with `npm run server:build`.
4. Start the backend with `npm run server:start`.
5. Start the frontend with `npm run dev`.

`npm run server:dev` is a watch-mode compiler for backend TypeScript; it does not start the Express process by itself.

## Quality Checks

Run before opening a PR:

```bash
npm run typecheck
npm run build
npm run test
```

## Security Rules

- Never commit `.env` files, wallet keypairs, private keys, access tokens, RPC private endpoints, or seed phrases.
- Keep MagicBlock and Solana production claims precise. Simulation must stay labeled as simulation.
- Do not add landlord UI fields that expose raw financial profile values.
- Do not allow landlord acceptance without backend proof verification.
