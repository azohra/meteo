---
title: Failures and schema artifacts
description: The closed upstream-failure vocabulary transports share, the shared zod schema primitives, and the machinery each capability uses to render its published JSON Schema artifacts.
---

Three pieces of shared machinery keep the platform's boundaries honest: a
closed vocabulary for upstream failure, zod schema primitives capability
configs share, and one renderer for the JSON Schema artifacts each
capability publishes, defined by
[`failures.ts`](https://github.com/azohra/meteo/blob/main/core/src/failures.ts),
[`schema.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema.ts),
and
[`schema-artifacts.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema-artifacts.ts).

## The failure vocabulary

When an upstream fails, the wire carries a reason code, not prose. The
vocabulary is closed. `UPSTREAM_FAILURE_REASONS` declares exactly four
codes:

| Reason | Meaning |
|---|---|
| `upstream_error` | The upstream failed: an error response, or a network refusal. |
| `timeout` | The request ran out of time or was aborted. |
| `rate_limited` | The upstream refused for rate. |
| `contract_break` | The upstream answered, but not in the shape the contract promises. |

Two types partition the vocabulary. `UpstreamFailureReason` is all four
codes: what the wire may carry. `UpstreamErrorReason` excludes
`contract_break`: it is the set an `UpstreamError` may be *thrown* with,
because `contract_break` is only ever the mapper's verdict, never thrown.

- **`UpstreamError`**: the error transports throw when they know why an
  upstream failed. It carries a `reason` (default `"upstream_error"`)
  alongside the human message.
- **`unavailableReasonForError(error)`**: maps any thrown value onto the
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

Closed binds what a transport may report, not what a capability's wire may
carry: a wire may extend the vocabulary with failures that are its own.
Station's `UNAVAILABLE_REASONS` is these four codes plus `not_configured`
(a config verdict no upstream ever produced), as
[its wire contract](/docs/station/wire-contract/) documents.

## Schema primitives

Three zod building blocks in
[`schema.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema.ts)
recur in capability configs:

- **`ianaTimeZone`**: a string `Intl.DateTimeFormat` accepts as a time
  zone; anything else fails with `not an IANA time zone`.
- **`httpUrl`**: a parseable URL whose protocol is `http:` or `https:`.
- **`positionFields`**: the position-claim fields station configs spread
  in: `elevationM` (finite), `latitude` (−90 to 90), and `longitude` (−180
  inclusive to 180 exclusive: exactly 180 is rejected, so every position
  has one canonical longitude; the
  [Tempest adapter](/docs/station/adapters/tempest/) normalizes a payload's
  180 to −180 before validating). All three are nullish: a config that
  claims no position stays null.

## Schema artifacts

Each capability that publishes wire documents also publishes JSON Schema
for them, committed under its own `schema/` directory
([briefing](https://github.com/azohra/meteo/tree/main/briefing/schema),
[station](https://github.com/azohra/meteo/tree/main/station/schema)),
and this module is the one renderer behind those files.

- **`SchemaArtifact`** declares one artifact: `fileName`, `title`, the zod
  `schema` it is generated from, and an optional `description`.
- **`ExampleArtifact`** declares an example wire document committed beside
  the schemas, validated against its schema before writing: a committed
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
ignore unknown keys (that is how the contracts evolve), and a schema that
rejected unknown keys would contradict the wire's own semantics.

Every committed schema is generated from its zod authority and ships with
its package; the zod schemas and their parse guards remain the behavioural
truth.
