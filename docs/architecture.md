# Architecture

## Ingestion and consistency

`DocumentIndex.ingest` walks a selected root, validates the files, and computes
SHA-256 hashes. It stages changed chunks before opening a write transaction.
Inside that transaction it checks the root again, removes stale FTS entries,
replaces changed documents, removes deleted documents, and records the revision.
An error rolls back the update. A failed first ingestion can leave an empty
database, but cannot publish a partial collection.

Readers use a separate read-only SQLite connection with WAL enabled by the
writer. A search reads its passages and revision in one transaction. Reading
context later may observe a newer snapshot; the caller can supply the earlier
document hash to detect that change. Refreshes are explicit and do not run in
the agent process.

The revision hashes sorted document paths, content hashes, and the index format
version. Citation IDs hash the relative path, line range, heading path, and text.
Line endings are normalized for storage, while hashes use the decoded source
content before line-ending normalization. A CRLF-only change therefore counts
as a document change.

File ingestion is not an atomic filesystem snapshot. Do not edit the corpus
while ingesting it; a same-size concurrent edit may be captured during that scan.
For deployments, ingest an immutable checkout. Symlink entries are skipped and
resolved paths are checked against the root. This is not a sandbox against a
local process that can replace files during ingestion.

## Retrieval

The database has documents, chunks, metadata, and an FTS5 table. FTS copies the
searchable text to keep updates and diagnostics straightforward at this scale.
Queries become at most 24 distinct literal Unicode word tokens joined by OR.
Common English function words are removed. Callers cannot inject FTS operators
or SQL. Results are ranked by BM25 with additional weight on section headings;
ties use path and line number for deterministic ordering.

Search returns at most ten chunks. It is lexical retrieval: no learned synonym
matching, stemming, embeddings, or automatic confidence threshold. BM25 values
are ranking scores, not probabilities. An unrelated passage can still share a
keyword. The answering agent must decide whether the evidence addresses the
question and can abstain.

The sample evaluation checks overlapping evidence spans. Macro recall@k averages
the fraction of required spans found for each question. MRR@k averages the inverse
rank of the first relevant passage, or zero when none is found. Neither metric
grades answer correctness. The checked-in questions are development regression
cases, not held-out evaluation data.

## Protocol and agent boundaries

The official MCP TypeScript SDK owns message validation and protocol negotiation.
The stdio transport writes protocol messages to stdout and diagnostics to stderr.
The HTTP adapter creates a server and stateless transport for each POST. It rejects
invalid origins/hosts, missing bearer tokens, bodies above 64 KiB, and unsupported
methods. It has no persistent MCP sessions or server notification stream.

The reference agent uses OpenAI Responses function calls. It preserves output
items, including reasoning state, when appending tool results. It does not turn
arbitrary model text into commands. The model can call only search, read, and a
local final-answer submission function. MCP calls and provider calls receive the
same abort signal. The OpenAI adapter disables retries so hidden retry loops do
not extend the requested work.

Each final answer must follow the schema and cite previously returned sources,
or explicitly report insufficient evidence. This is a provenance check, not an
entailment checker. Model refusals, context limits, exhausted budgets, or transport
failures can terminate the run without an answer. The CLI exits nonzero in those
cases. Traces contain tool names and citations; raw model reasoning is not logged.

## Scope

This release targets a single local documentation collection. It does not offer
remote ingestion, document-level permissions, multi-user hosting, or a public
MCP endpoint. A production shared service would need an authentication design,
tenant isolation, retention controls, and evaluation on its actual corpus.

Protocol references:

- [MCP transports specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP TypeScript SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
