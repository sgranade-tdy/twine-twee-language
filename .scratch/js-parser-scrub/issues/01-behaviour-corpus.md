# 01 — Behaviour corpus for symbol extraction

Type: task
Status: closed

The existing tests spell each case out longhand — ~30 lines per case, asserting
full `Location` objects — which is why ten defects sat unnoticed in
`server/src/test/js-parser.test.ts`. You cannot read the file and see what the
parser does.

This issue captures **current** behaviour, defects included, as a compact table.
It is the baseline every later issue edits: each subsequent change should touch
exactly the rows it means to change, so the behaviour diff is visible in review.

## Work

1. Add a table-driven suite to `server/src/test/js-parser.test.ts`. Each row is
   `{ input, isProgram, assignmentIsDefinition, variables, properties }`, where
   the expectations are compact strings: `obj` for a read, `obj=` for a write,
   `obj.a.b=` for a written property carrying its prefix. Have it match the table-
   driven suite in `server/src/test/acorn-errors/acorn-errrors.test.ts` as is
   sensible.
2. Seed it with the probe corpus below, recording what the parser does **today**.
   Mark known-wrong rows with a trailing `// defect N` comment referencing the
   spec's table, so the later issues can find them.
3. Keep a handful of longhand tests asserting exact `Location` ranges and
   offsets. The compact form deliberately hides positions, so it can't catch an
   off-by-one.

## Corpus

At minimum, cover:

- **Chains**: `a.b = 1`, `obj.a.b.c = 1`, `obj?.a?.b`, `obj['k']`, `obj[1]`,
  `obj['a b']`, `obj[i].name`, `obj.items[0].name`, `obj().a`, `obj.a.b().c`
- **Object literals**: `obj = {a: {b: 1}}`, `obj.x = {a: 1}`, `var obj = {a: 1}`,
  `obj = {a}`, `obj = {a: b}`, `obj = {'k': 1}`, `obj = {1: 'x'}`,
  `x = {[k]: 1}`, `obj = {get a(){return 1}}`
- **Binding forms**: `let {a, b} = obj`, `function f(){ var o = {a:1} }`,
  `for (let i=0;i<n;i++){i}`, `for (var j in obj){j}`, `for (a of b){}`,
  `while(a){let b=1;b}`, `try{a()}catch(e){e.message}`, `class A {}`,
  `a = () => { b = 1 }`, `foo = function(){ inner = 1 }`
- **Writes**: `a = b = 1`, `a += 1`, `a++`, `[a,b] = c`, `({a} = c)`,
  `a.b += 1`, `var a; a = 1`, each with and without `assignmentIsDefinition`
- **Calls**: `foo(bar)`, `foo(bar.baz)`, `a = foo(b)`, `new Foo(bar)`,
  `obj.method(x)`, `obj.a.method(x)`, `setTimeout(fn, 1)`, `parseInt(a)`,
  `$('#x').hide()`
- **Built-ins**: `Math.max(a,b)`, `console.log(a)`, `window.foo = 1`,
  `RegExp.test(a)`, `globalThis.z = 1`, `this.foo = 1`, `arr.length`,
  `State.variables.foo = 1`, `setup.x = 1`
- **Broken input** (loose parse): `a = `, `obj.`, `a.b.`, `a ||= 1`, `n = 1_000`,
  `class A { foo = 1 }`, `export const a = 1`

## Not in scope

Changing any behaviour. Every row here records what happens today, including the
defects. If a row looks wrong, comment it; don't fix it.

## Done when

- The corpus above is asserted in compact form and `npm test` is green against
  **unmodified** `js-parser.ts`.
- Every defect in the spec's table has a corresponding commented row.
