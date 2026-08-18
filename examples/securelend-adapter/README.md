# SecureLend participant adapter

UWBench-side protocol adapter for the SecureLend underwriting agent. It does
**not** import SecureLend internals (ADR-001). This process always speaks the
UWBench agent protocol locally (`GET /health`, `POST/GET/DELETE /v1/runs`).

It has two modes. Set **one** upstream:

| Mode               | When                                                          | What it does                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Protocol proxy** | `SECURELEND_AGENT_URL` is set                                 | Forwards `POST/GET/DELETE /v1/runs` to a SecureLend host that already implements ADR-002. `GET /health` stays local so published cells get a harness × model identity. If both URLs are set, this mode wins. |
| **MCP chat path**  | `SECURELEND_MCP_URL` is set and `SECURELEND_AGENT_URL` is not | Serves `/v1/runs` in-process. Each run creates a **new** deal workspace and drives the live product sequence used by `securelend-frontend` agents-chat (`tools/call` on `/mcp`).                             |

`SECURELEND_MODEL` is an identity label only. It is written on `GET /health`
and is not sent as a model picker to SecureLend.

Scores are benchmark artifacts, not credit opinions. Do not claim these as
live-client SecureLend product performance.

## Protocol-proxy mode

Use this when SecureLend (or a sidecar) already exposes UWBench `GET /health`
and `POST/GET/DELETE /v1/runs`. The adapter does not invent that host.

```bash
SECURELEND_AGENT_URL=http://127.0.0.1:8080 \
SECURELEND_MODEL=claude-sonnet-4-6 \
SECURELEND_MODEL_VERSION=2026-02-19 \
SECURELEND_PROVIDER=anthropic \
SECURELEND_HARNESS_VERSION=0.4.2 \
PORT=9200 \
  node examples/securelend-adapter/dist/server.js
```

The run request, including the run-scoped UWBench `toolGateway`, is forwarded
unchanged. This adapter does not drop that behavior.

## MCP chat-path mode

Live SecureLend does not implement `/v1/runs`. The product path is MCP:

`POST {SECURELEND_MCP_URL}` with JSON-RPC 2.0 `tools/call` and
`Authorization: Bearer <token>`.

Do **not** register an M2M client from this adapter (`POST /oauth/m2m/register`
is out of scope). Supply a token you already have (Cognito JWT or an existing
`client_credentials` bearer). Never commit tokens. Tests use a mock MCP server
and must not call `agents.securelend.ai`.

**Pointing this mode at production creates a new workspace per run and consumes
that identity's quota** (document intelligence, extraction, memo, …).

```bash
SECURELEND_MCP_URL=https://agents.securelend.ai/mcp \
SECURELEND_MCP_TOKEN='your-bearer-token-value-only' \
SECURELEND_MODEL=claude-sonnet-4-6 \
SECURELEND_PROVIDER=anthropic \
PORT=9200 \
  node examples/securelend-adapter/dist/server.js

# or: SECURELEND_MCP_TOKEN_FILE=/path/to/token

pnpm uwbench suite --suite raw-documents-v0.1 --lane raw_documents \
  --agent http://127.0.0.1:9200 \
  --output-dir benchmark/results/securelend-raw-documents

pnpm uwbench matrix --dir benchmark/results/securelend-raw-documents
```

A run:

1. Reads the UWBench case through the run-scoped tool gateway (same case
   package the other harness adapters see).
2. Calls `create_deal_workspace` with `name` / `clientName`
   `uwbench-{caseId}-{timestamp}`. It does **not** write into a hardcoded
   customer tenant or reuse production workspace IDs.
3. If the case has uploadable files, calls `submit_documents` with the live
   required top-level `filename` and `contentType` (plus the nested
   `documents[]` payload) and PUT/POSTs bytes to the returned `uploadUrl` /
   `uploadFields`. Use the **SecureLend** `documentId` from that response for
   later tools — not the UWBench case document id.
4. Do **not** set `SECURELEND_DOCUMENT_API_URL`. Upload proceeds without
   finalize; that URL 404s on the live product.
5. Frontend lending sequence **only after a string `documentId` exists**
   (or public-catalog aliases if `tools/list` has those instead):
   `run_document_intelligence` → `run_data_extraction`
   (`blueprintType=financial_statement`, `documentId` required) → optional
   `run_financial_statement_spread` → `run_professional_memo`
   (`sourceType=workspace`, `sourceId=workspaceId`) → poll `get_memo_status`.
   Intelligence and extraction throws on a synthesized pack are caught; pack
   mapping still completes.
6. **reasoning_only / already-extracted packs:** `case.list_documents` is often
   empty (commercial-credit-v0.1 does not load PDFs on that lane). The adapter
   loads public structured records and discovers term-loan rules via
   `policy.search` / `policy.get_rule`. It synthesizes a plain-text financial
   package from those already-loaded records, uploads it through
   `submit_documents`, and then runs intelligence / extraction / spread using
   the **SecureLend** `documentId`. It never calls those tools with a missing
   `documentId`. The UWBench case package is still stored on workspace
   `metadata`, and `run_professional_memo` uses `sourceType=workspace`.
7. Maps the already-loaded pack `financialSpread` and `normalizedFacts` onto a
   UWBench `UnderwritingSubmission` (the runner stuffs that canonical object
   into every reasoning_only record). Product extract/spread is exercised when
   a SecureLend `documentId` exists, but it does not replace pack cells.
   Citations use catalog `sourceId`s only (`src_financials_2024`,
   `src_borrower_profile`, `src_policy_*`) — never `normalized:canonical-input`.
   Tight liquidity (for example current 1.35x vs a 1.20x floor) becomes
   `APPROVE_WITH_CONDITIONS` with concrete conditions. Dummy workspace-mapping
   claims are not emitted.

This is **not** SecureLend's planned local sidecar
(`mcp-agents/src/benchmark/`). That lives in the product repo.

### MCP-mode environment

| Variable                                                                                                          | Required       | Role                                                    |
| ----------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------- |
| `SECURELEND_MCP_URL`                                                                                              | yes (MCP mode) | MCP endpoint, e.g. `https://agents.securelend.ai/mcp`   |
| `SECURELEND_MCP_TOKEN` or `SECURELEND_MCP_TOKEN_FILE`                                                             | yes (MCP mode) | Bearer **value only** (a leading `Bearer ` is stripped) |
| `SECURELEND_MODEL`                                                                                                | yes            | Identity label on `/health`                             |
| `SECURELEND_DOCUMENT_API_URL`                                                                                     | no             | Unused. Do not set; live finalize 404s                  |
| `SECURELEND_MCP_POLL_INTERVAL_MS`                                                                                 | no             | `get_memo_status` poll interval (default `2000`)        |
| `SECURELEND_MCP_POLL_TIMEOUT_MS`                                                                                  | no             | Memo poll timeout (default `180000`)                    |
| `SECURELEND_MODEL_VERSION` / `SECURELEND_PROVIDER` / `SECURELEND_PROVIDER_VERSION` / `SECURELEND_HARNESS_VERSION` | no             | Extra identity fields (default `undeclared`)            |
| `PORT`                                                                                                            | no             | Listen port (default `9200`)                            |

## Tests

```bash
pnpm --filter @uwbench/securelend-adapter test
```

Unit and integration tests drive a **mock** MCP + upload server. They do not
hit `agents.securelend.ai`.
