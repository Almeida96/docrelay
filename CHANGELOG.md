# Changelog

## Unreleased

Enforce agent deadlines and caller cancellation even when an adapter ignores its abort signal. Add regression tests with never-settling provider and tool promises.

## 0.1.0 — 2026-10-29

- Index Markdown and text documents in SQLite with content hashes, bounded chunks,
  heading paths, and incremental updates.
- Search and read indexed sources through stdio or local Streamable HTTP MCP.
- Return source lines, document hashes, and index revisions for traceable answers.
- Include a bounded Responses agent loop with citation checks and an offline
  protocol demo.
- Add a 24-question retrieval evaluation over eight sample runbooks.
- Test ingestion failures, MCP clients, HTTP access checks, and agent error paths.
