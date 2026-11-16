# Go to definition for story properties

## Problem Statement

Go-to-definition on a story variable (`$player`, `{player}`) lists every
assignment to it. On a **story property** (`$player.hp`, `{player.hp}`) it
does nothing, in both SugarCube and Chapbook. Authors who want to know where
`hp` gets its value have to fall back to find-references and pick out the
writes by hand. The README doesn't say what navigation works on variables
either.

## Solution

A story property's definition is every **assignment** to its full dotted
path anywhere in the project, mirroring story variables. Both story formats
use the same rule.

## Implementation Decisions

- **What counts**: every `PropertySet` occurrence whose full path matches,
  project-wide and unfiltered. That includes object-literal keys
  (`<<set $p to {hp: 1}>>` sets `p.hp`) and writes from script code.
- **What doesn't**: writes to an ancestor path (`$player to …`), opaque
  assignments above the property, and shape sources. Following shape sources
  would make navigation disagree with find-references and rename (see
  "Navigating shape sources" in `../opaque-assignments/spec.md`).
- **No writes, no definition**: built-ins (Chapbook `config.*`), properties
  only beneath an opaque path, and never-set properties return nothing, the
  same as never-set variables.
- **The write under the cursor is included**, as for variables.
- **No special-casing** of built-in JS properties or callees (`$inv.length`,
  `$inv.push()`): they find no writes and return nothing.
- **One rule for both formats.** Each format's definition provider calls
  `getAssignmentLocations` with its `PropertySet` kind and the property's full
  path. No new wrapper; the function's doc comment widens to "story variable
  or property".
- **Invariant (Chapbook)**: Chapbook properties never hang off a
  **conditional reference**. The script extractor records no properties for
  bare names, and passage-text roots are always story variables. So variable
  qualification (`isDisqualifiedConditionalAt`) never applies to properties.
  If Chapbook ever records properties off conditional roots, property
  definitions, references and rename need the same qualification variables
  get.

## Testing Decisions

One end-to-end case per format at the definition seam: definitions on a
property list its direct writes (including an object-literal key and a
script-code write), and a property with no direct writes returns nothing.

## Documentation

- CHANGELOG: an Unreleased → Added entry.
- README: in both the Chapbook and SugarCube feature lists, replace "Find and
  rename variables" with wording that covers variables and their properties
  and going to where they're set.

## Out of Scope

- Following shape sources or ancestor writes.
- Harlowe and other formats without story property kinds.
