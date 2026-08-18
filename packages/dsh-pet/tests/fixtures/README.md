# Phase 0 compatibility fixtures

These fixtures freeze the last pre-stable behavior before Presentation, Native Bridge, Renderer, and Model contracts are introduced.

- `desktop-config-v6.json` preserves every V6 desktop field needed by the future V7 migration.
- `sse-state-v1.json` preserves the complete V1 state payload carried in one SSE `data:` frame.
- `petdex-v1/pet.json` preserves the implicit Sprite V1 manifest form.
- `petdex-v2/pet.json` preserves the explicit Sprite V2 manifest form.

Fixtures contain no machine-specific paths, credentials, executable code, or licensed model assets. Tests must consume them directly so a future migration cannot silently edit the baseline to match its new output.
