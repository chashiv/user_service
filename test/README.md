# Tests

This folder is reserved for end-to-end tests (`*.e2e-spec.ts`). Unit tests live
next to the code they test, e.g. `src/auth/auth.service.spec.ts`.

Neither flavour is wired up yet — no Jest config, no test runner installed —
but the folder layout is reserved so the project doesn't have to be reshuffled
when tests are added.

When you want to enable tests:

```powershell
npm install --save-dev jest @types/jest ts-jest supertest @types/supertest
```

…then add a `"test"` and `"test:e2e"` script to `package.json` and a
`jest-e2e.json` config that points `rootDir` here. The repository's
`tsconfig.json` already has `experimentalDecorators` + `emitDecoratorMetadata`
on, which is what `ts-jest` needs to compile Nest decorators.
