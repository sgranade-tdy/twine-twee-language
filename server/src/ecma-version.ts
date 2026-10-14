import type * as acorn from "acorn";

/**
 * The ECMA version we're going to parse with.
 */
export const ParseEcmaVersion: acorn.ecmaVersion = "latest";

/**
 * The ECMA version eslint-scope analyzes with. It compares the version
 * numerically, so it can't take Acorn's `"latest"`: that silently gives
 * ES5 scoping (no `let`/`const`/classes/block scope). Raise it as Acorn gains
 * new syntax that affects scoping.
 */
export const ScopeEcmaVersion = 2026;
