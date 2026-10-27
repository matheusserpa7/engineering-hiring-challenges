import { z } from 'zod';

// nginx's CSP forbids eval, so Zod's JIT probe (a caught `new Function`) would be reported as a
// violation on every page load. Schemas here are small; the interpreter is plenty fast.
// A module of its own, imported first: the shared schemas are built while main.ts's other
// imports evaluate, which is before any statement in main.ts runs.
z.config({ jitless: true });
