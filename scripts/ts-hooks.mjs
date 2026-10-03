/**
 * Resolve hook for running the project's TypeScript scripts under Node ≥ 23.6 (built-in type stripping):
 * an extensionless relative import (`../src/core/profile`) is completed with `.ts` or `/index.ts`, as Vite
 * does. Usage: `node --import ./scripts/ts-hooks.mjs scripts/<script>.ts`.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    const absolute = specifier.startsWith('/');
    if ((relative || absolute) && !/\.[a-z]+$/i.test(specifier) && (absolute || context.parentURL)) {
      const base = absolute ? pathToFileURL(specifier).href : new URL(specifier, context.parentURL).href;
      for (const suffix of ['.ts', '/index.ts']) {
        if (existsSync(fileURLToPath(base + suffix))) return nextResolve(base + suffix, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
