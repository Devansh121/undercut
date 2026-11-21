# 0002 Stack

Status: accepted (M0).

TypeScript strict in one npm-workspaces repo (pnpm is not installed on the owner's machine); Vite; three.js on WebGL 2; Vitest; Playwright; ESLint flat config and Prettier.
Packages are consumed as TypeScript source through workspace `exports`, with no per-package build step; `tsc` only typechecks.
Tool versions are the newest that run on Node 20.19 (wrangler 4.86, Vitest 4.1) and that typescript-eslint supports (TypeScript 5.9).
