# Contributing

Use Node.js 24 and the pinned pnpm version. Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm demo` and `pnpm evaluate`.

Keep ingestion atomic: invalid input must preserve the previous complete snapshot. Add source-line assertions when changing chunking, and protocol tests when changing an MCP tool. A passing unit mock is not a substitute for client/server interoperability.

Agent tests use scripted provider responses and must not need credentials. Add cases for budget exhaustion, cancellation and invalid citations when changing the loop. Never include real secrets or private documents in fixtures.

Evaluation results describe the checked-in runbooks only. If retrieval changes, regenerate the report, inspect missed spans and state the dataset limitations in the README.
