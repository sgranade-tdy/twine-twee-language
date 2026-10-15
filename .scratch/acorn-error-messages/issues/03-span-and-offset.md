# 03 — Replace `{contents, at}` with a span, and rebase at the source

Type: task
Status: closed
Blocked by: 01

`JSDiagnostic.contents` is a length in disguise. `createDiagnosticFor`
(`server/src/diagnostics.ts:412`) does `createDiagnostic(code, at, at + text.length, ...)`
and throws the string away. Every rule that sets `contents` is doing arithmetic by
proxy. This is the enabling interface change for phases 06 and 07.

## Work

1. Change `JSDiagnostic` (`server/src/js-parser.ts:82`) from `{contents, at}` to a
   real span. Update the two consumers:
   `server/src/passage-text-parsers/chapbook/chapbook-parser.ts:145` and
   `server/src/passage-text-parsers/sugarcube/sugarcube-utils.ts:128`. Both
   currently call `logDiagnosticFor(code, error.contents, error.at, state, error.message)`;
   they should use `createDiagnostic`-style start/end instead.
2. Give `improveAcornErrorMessage` a document-offset parameter and have it return
   document-relative positions. Delete `js-parser.ts:1119`'s
   `tokenized.error.at += offset`.

Point 2 matters more than it looks. With a span — and later, possibly related
positions — a single `+= offset` mutation rebases one position out of several,
and the rest silently stay in text-relative coordinates. Taking the offset as a
parameter means there is no window in which a half-rebased diagnostic exists.

## Not in scope

Related diagnostic information ("the matching `{` is here"). `createDiagnostic`
(`server/src/diagnostics.ts:357`) builds a flat `TwineDiagnostic` with one range
and can't carry LSP `DiagnosticRelatedInformation`. Widening it is a separate
effort.

Also not in scope: covering the delimiter's full extent with the primary span. A
squiggle running from an unclosed brace to end of passage is worse than useless.

## Done when

- No `contents` field remains on `JSDiagnostic`.
- No offset arithmetic remains at the `js-parser.ts` call site.
- The phase 01 table asserts spans, and `npm test` is green.
