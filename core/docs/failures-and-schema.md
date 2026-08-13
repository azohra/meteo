---
title: Failures and schema artifacts
description: The closed upstream-failure vocabulary transports share, and the machinery each capability uses to render its published JSON Schema artifacts.
---

Two pieces of shared machinery keep the platform's boundaries honest: a closed
vocabulary for upstream failure, and one renderer for the JSON Schema
artifacts each capability publishes. This page is the authority for both as
[`failures.ts`](https://github.com/azohra/meteo/blob/main/core/src/failures.ts)
and
[`schema-artifacts.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema-artifacts.ts)
define them.

## The failure vocabulary

When an upstream fails, the wire carries a reason code, not prose. The
vocabulary is closed — `UPSTREAM_FAILURE_REASONS` declares exactly four
codes:

| Reason | Meaning |
|---|---|
| `upstream_error` | The upstream failed: an error response, or a network refusal. |
| `timeout` | The request ran out of time or was aborted. |
| `rate_limited` | The upstream refused for rate. |
| `contract_break` | The upstream answered, but not in the shape the contract promises. |

Two types partition the vocabulary. `UpstreamFailureReason` is all four
codes — what the wire may carry. `UpstreamErrorReason` excludes
`contract_break`: it is the set an `UpstreamError` may be *thrown* with,
because `contract_break` is only ever the mapper's verdict, never thrown.

- **`UpstreamError`** — the error transports throw when they know why an
  upstream failed. It carries a `reason` (default `"upstream_error"`)
  alongside the human message.
- **`unavailableReasonForError(error)`** — maps any thrown value onto the
  wire's reason codes: an `UpstreamError` keeps its own reason; an `Error`
  named `TimeoutError` or `AbortError` becomes `timeout`; a `TypeError`
  becomes `upstream_error`, because `fetch` rejects network refusals as
  `TypeError`; anything else is `contract_break`.

```ts
import { UpstreamError, unavailableReasonForError } from "@azohra/meteo.core";

try {
  throw new UpstreamError("provider returned 429", "rate_limited");
} catch (error) {
  const reason = unavailableReasonForError(error); // "rate_limited"
}
```

The reason code travels; words, retries, and presentation are the
consumer's.

## Schema artifacts

Each capability that publishes wire documents also publishes JSON Schema
for them — committed under its own `schema/` directory
([briefing](https://github.com/azohra/meteo/tree/main/briefing/schema),
[station](https://github.com/azohra/meteo/tree/main/station/schema)) —
and this module is the one renderer behind those files.

- **`SchemaArtifact`** declares one artifact: `fileName`, `title`, the zod
  `schema` it is generated from, and an optional `description`.
- **`ExampleArtifact`** declares an example wire document committed beside
  the schemas, validated against its schema before writing — a committed
  example can never drift from its contract.
- **`schemaArtifactJson(artifact)`** produces the artifact's JSON Schema
  document, exactly as shipped: the zod schema converted to JSON Schema
  draft 2020-12, wrapped with `$schema`, the `title`, the `description`
  when present, and an `$id` of
  `https://meteo.azohra.com/schema/<fileName>`.
- **`renderJsonArtifact(value)`** / **`renderSchemaArtifact(artifact)`**
  produce the exact shipped bytes: two-space-indented JSON with a trailing
  newline.

One deliberate choice: the conversion runs with zod's `io: "input"`, so a
published schema never carries `additionalProperties: false`. Wire readers
ignore unknown keys — that is how the contracts evolve — and a schema that
rejected unknown keys would contradict the wire's own semantics.

Regenerate every committed artifact with `pnpm schemas` from the repository
root; never edit a generated schema by hand. Each capability's contract test
deep-compares the committed files with their zod authority, so a hand edit
fails the suite it belongs to.
