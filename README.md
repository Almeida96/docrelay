# DocRelay

[![CI](https://github.com/Almeida96/docrelay/actions/workflows/ci.yml/badge.svg)](https://github.com/Almeida96/docrelay/actions/workflows/ci.yml)

Give an agent access to your runbooks, project notes, and technical documentation
through MCP. DocRelay indexes a directory locally and returns searchable passages
with file paths, line numbers, and document hashes.

For example, an agent investigating a stalled queue can find the replay procedure,
read the surrounding lines, and cite the rate limit in its answer. You choose the
document directory; the server cannot browse the rest of your filesystem.

```text
Markdown / text files → incremental SQLite index → MCP tools → agent
                               ↑                    ↓
                          ingest command       source citations
```

## Try it

Requires Node.js 24 or later. No database server or API key is needed for indexing,
search, MCP, or the sample evaluation.

```sh
git clone https://github.com/Almeida96/docrelay.git
cd docrelay
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

The demo starts a real MCP server as a child process, connects with the official
MCP client, lists its tools, and searches the included fictional operations docs.
It is a protocol and retrieval demo; it does not generate an answer with a model.

The first result for `dead-letter queue replay rate` includes:

```text
[queue.md:14-22]
## Dead-letter queue replay

Messages enter the dead-letter queue after five failed delivery attempts.
Identify the failure class and fix its cause before replaying messages.
Replay at 20 messages per second into the original orders queue.
Keep the original event_id so the fulfillment consumer can deduplicate it.
```

To install the packaged CLI without cloning:

```sh
npm install --global https://github.com/Almeida96/docrelay/releases/download/v0.1.0/docrelay-0.1.0.tgz
docrelay ingest --root ./docs
docrelay search "retry budget"
```

The package is distributed through GitHub Releases. It is not published on npm.

## Index your documents

```sh
node dist/cli.js ingest --root ./examples/runbooks
node dist/cli.js search "rollback error rate" --limit 3
node dist/cli.js search "replay" --path-prefix queue
node dist/cli.js status
```

Run `ingest` again after editing the source files. Content hashes identify changed
documents; only changed documents have their passages replaced. Deleted files
are removed from the index. A transaction publishes the complete update, so a
running server sees the new snapshot without a restart. Search never silently
reindexes documents.

Each index belongs to one document root. Use `--db /absolute/path/index.db` to
keep separate collections. The default is `.docrelay/index.db` in the current
directory. The index contains a copy of the source text and should be treated
with the same care as those files.

Accepted files: `.md`, `.mdx`, and `.txt`, encoded as UTF-8. Hidden files and
directories, symlinks, `node_modules`, `vendor`, `build`, `dist`, and `coverage`
are skipped. PDF, HTML, code execution, and remote URL ingestion are not supported.
Limits are 2,000 documents, 1 MiB per file, 20 MiB total, and 4,000 characters per
source line. Select a documentation directory rather than an entire monorepo.

## Connect an MCP client

For a client that uses an `mcpServers` JSON configuration:

```json
{
  "mcpServers": {
    "docrelay": {
      "command": "node",
      "args": [
        "/absolute/path/docrelay/dist/cli.js",
        "serve",
        "--db",
        "/absolute/path/docrelay/.docrelay/index.db"
      ]
    }
  }
}
```

Ingest the documents first. Use absolute paths because the client may start the
server from a different working directory. On Windows, JSON paths can use forward
slashes, for example `C:/projects/docrelay/dist/cli.js`. Configuration file names
and locations depend on your MCP client.

| Tool | Purpose |
| --- | --- |
| `search_documents` | Ranked passages, source lines, hashes, and index revision |
| `read_document` | Up to 120 lines / 16,000 characters from an indexed source |
| `list_documents` | Paginated paths, hashes, and line counts |
| `index_status` | Document count, chunk count, revision, and ingestion time |

The server also exposes `docrelay://index/status` as an MCP resource. Tools are
read-only. Refreshing the index remains an explicit CLI operation. The
`expectedHash` argument on `read_document` rejects a source that changed after
search, allowing an agent to retrieve fresh evidence before citing it.

For local Streamable HTTP, set a random bearer token and start the endpoint:

```sh
export DOCRELAY_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
node dist/cli.js serve --transport http --port 7331
```

PowerShell:

```powershell
$env:DOCRELAY_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node dist/cli.js serve --transport http --port 7331
```

Connect to `http://127.0.0.1:7331/mcp` with the header
`Authorization: Bearer YOUR_TOKEN`. This is a stateless, JSON-response MCP
transport. It binds to loopback, validates Host and Origin, and requires a token.
Public hosting, OAuth, and multi-user authorization are outside this release.
See [the HTTP client example](examples/http-client.mjs).

## Ask with the reference agent

```sh
export OPENAI_API_KEY="your-api-key"
export OPENAI_MODEL="your-enabled-model-id"
node dist/cli.js ask "When should we pause a dead-letter replay?"
```

Use a model available in your account that supports Responses function calling.
In PowerShell, set environment variables with `$env:OPENAI_API_KEY = "..."` and
`$env:OPENAI_MODEL = "..."`. No model is selected implicitly.

The agent connects to DocRelay over MCP, searches, optionally reads more context,
and submits a structured answer with citations and a tool trace. It has an
eight-turn budget, a twelve-call budget, a two-minute timeout, and a 60,000-character
retrieved-evidence budget. Calls are schema-validated. Unknown tools are rejected.
It cannot execute shell commands or change documents.

Only citations returned by its tools are accepted. This checks source provenance;
it does **not** prove that every claim is supported by the cited passage. The agent
can declare `insufficientEvidence` when the collection does not answer a question.
Retrieved text is treated as untrusted data in the prompt, which is not a guarantee
against prompt injection.

`ask` sends the question and retrieved text to OpenAI and incurs API usage.
Indexing and MCP remain local; an external MCP client may send tool results to
its own model provider. Choose source documents accordingly.

## Retrieval evaluation

```sh
pnpm evaluate
pnpm test
```

The included dataset has 24 hand-written questions over eight fictional runbooks,
including two questions that require evidence from multiple documents. Expected
answers are represented by source spans. The evaluator checks whether retrieved
passages overlap those spans and reports macro recall@k and mean reciprocal rank.

The current [saved report](examples/evaluation.json) has **recall@5 = 1.000** and
**MRR@5 = 0.927**. These are regression results on a small, known dataset, not a
general benchmark, a semantic-search score, or a measure of generated-answer quality.
The dataset was used during development. Add your own queries before choosing
retrieval settings for another collection.

## Design and limits

SQLite FTS5 ranks literal terms with BM25. Heading paths are included in each
chunk, and heading-only chunks are omitted. This keeps sections such as
“Webhook delivery / Acknowledgment and delivery” searchable by the document topic.
There are no embeddings or vector database dependencies. Synonyms, paraphrases,
and multilingual questions can still miss relevant evidence; a model can try
another keyword query, but retrieval is not guaranteed.

Passages follow headings and split at 60 lines or approximately 6,000 characters.
Long individual lines may make a passage larger than that character target.
Markdown headings inside fenced code blocks do not change section boundaries.
The source file is never executed, and reads come from the indexed snapshot.

The current implementation scans and hashes all accepted files on ingestion;
incremental refers to database and chunk updates, not filesystem watching.
There is no continuous watcher, reranker, stemming, or access control per document.
See [architecture](docs/architecture.md) for the failure behavior and tradeoffs.

## Development

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm demo
pnpm evaluate
pnpm pack
```

Tests cover ingestion and rollback, stale sources, removals, query parsing,
pagination, source bounds, both MCP transports, HTTP access checks, agent budgets,
failure recovery, and citation validation. CI runs on Linux, Windows, and macOS
with Node 24 and smoke-tests the packed CLI in a separate project.

The agent-loop tests use scripted provider responses. A live model response is
not required for CI, and no live OpenAI call was used to validate this release.
The offline demo and MCP integration tests use the real protocol and SDK.

MIT license.
