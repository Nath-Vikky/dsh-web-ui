# dsh-pet — Desktop pet companion

English | [中文](README.zh.md)

`dsh-pet` is a task-aware desktop companion for DeepSeek Harness. The Host plugin projects official session activity into pet intents, while the Electron app renders the selected pixel model in a transparent desktop window.

The former in-page whale-girl overlay has been removed. Installing this plugin no longer mounts a floating pet, summon button, sprite transport, or asset routes into the DSH web page; the browser client only contributes the desktop companion settings card.

## Features

| Feature | Description |
|---|---|
| Desktop window | Transparent Electron window, tray controls, smooth dragging, persistent position, position lock, and always-on-top behavior |
| Task awareness | Official DSH session events drive waiting, working, tool, review, completion, failure, and idle animations |
| Interactions | Head pats and feeding update affinity, dried-fish stock, and feedback |
| Pixel models | Built-in whale-girl fallback, local PetDex model discovery, safe folder import, model switching, and a separate saved name for each model |
| Managed lifecycle | Starts with the Web DSH Host and exits when the owning Harness process stops; the settings switch can stop or restart it |
| Shared settings | Window visibility, always-on-top, and position lock stay synchronized between the Web settings card and the desktop tray/drawer |
| Adaptive settings location | Aggregate installs use Settings → Plugins → Web UI Plugins → Pet; standalone installs use Settings → Plugins → Pet |

Model selection and per-model names remain in the desktop pet panel because imported model catalogs live on the desktop side, not in the browser Host.

## Architecture

```text
packages/dsh-pet/
|-- src/index.ts            Host plugin, settings, routes, desktop lifecycle
|-- src/service.ts          task state, affinity, treats, companion settings
|-- src/routes.ts           local REST/SSE bridge under /api/pet/*
|-- src/settings-bridge.ts  narrow loopback fallback for standalone settings
|-- src/settings-protocol.ts shared fallback wire contract
|-- src/core/               multi-session projection and PetIntent mapping
|-- src/client/index.ts     settings-card registration only
|-- src/client/             settings card and standalone fallback scope
`-- desktop/
    |-- src/main/           Electron lifecycle, window, tray, Host client
    |-- src/renderer/       desktop pet panel and pixel renderer
    |-- src/shared/         validated IPC and bridge contracts
    |-- resources/          packaged tray icon
    `-- pixelmodel/         ignored local-development PetDex directory
```

### Data flow

```text
official DSH session events
          |
          v
PetService + PetIntent ---- /api/pet/events (SSE) ---> Electron desktop pet
          ^                                               |
          |                                               |
          `--- /api/pet/companion-settings <--------------'

Web settings card <---- pet settings namespace ----> PetService
```

- The desktop client prefers SSE and falls back to `/api/pet/state` polling while the stream is unavailable.
- Head-pat and feeding actions use `/api/pet/interact`.
- Desktop window changes use `/api/pet/companion-settings` and are mirrored into the same `pet` settings namespace.
- When the official DSH settings RPC does not expose third-party namespaces, a loopback-only `/api/pet/settings/*` fallback preserves the same revision-fenced settings document semantics. Aggregate installs prefer the shared `dsh-web-ui-settings` compatibility binder.
- The browser client never renders the pet itself.

## Install

Standalone package:

Electron 43 downloads its platform binary through this package's `postinstall`. pnpm 11 blocks dependency build scripts until the profile explicitly trusts the package. Add this entry to `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml` before installation:

```yaml
allowBuilds:
  '@linxin666/dsh-pet': true
```

Then install the bundle:

```sh
dsh plugin --profile web add @linxin666/dsh-pet
```

The package contains the prebuilt Host/browser outputs and desktop runtime. It also declares Electron as a runtime dependency, so no sibling checkout or global Electron installation is required. The authorization is security-sensitive: it permits the package lifecycle script to download the official platform-specific Electron binary.

For a local tarball, file, or Git artifact, pnpm keys the approval by the exact artifact spec instead of the registry package name. Let the first blocked install write its exact placeholder under `allowBuilds`, change that generated value to `true`, then run `dsh plugin --profile <profile> install`. Do not guess or copy a machine-specific artifact key into shared configuration.

The aggregate package already depends on `@linxin666/dsh-pet`; installing `@linxin666/dsh-web-ui-all` therefore installs and activates the same pet bundle without a second patch row.

Source-checkout development:

```sh
pnpm install
pnpm --filter @linxin666/dsh-pet build
dsh plugin --profile web add link:<checkout>/packages/dsh-pet
```

Restart `dsh web` after installation. The Host plugin launches the desktop runtime from inside its own package. Rebuild the package after changing Host/client or Electron code; link installs do not need to be added again.

## Settings

The Web settings card manages:

- Launch desktop pet
- Show desktop pet
- Always on top
- Lock position

The desktop pet panel manages the Web DSH target, pixel model selection/import, and each model's saved display name.

## Configuration and data

The Cordis entry exports a typed `Config` and same-named Schemastery schema. Deployment defaults for affinity, treats, celebration timing, persistence, activity metadata, and the lifecycle switch can be overridden in the plugin row's `config` object and are validated before startup.

- Host affinity and treat data stay under `$DSH_HOME` by default (`pet.json`).
- Desktop window/model preferences use Electron's platform `userData` directory.
- Imported PetDex models are copied into `userData/pixel-models`; the installed package is never modified.
- `desktop/pixelmodel` is an ignored source-checkout discovery directory for local model development only.

## Development

```sh
pnpm --filter @linxin666/dsh-pet typecheck
pnpm --filter @linxin666/dsh-pet test
pnpm --filter @linxin666/dsh-pet build
pnpm --filter @linxin666/dsh-pet desktop:smoke
```

## Known limitations

- The companion currently connects only to a loopback Web DSH origin. Desktop and CLI Harness adapters are intentionally deferred.
- PetDex version 1 and 2 atlases are accepted, but their available tracks are mapped onto the current nine DSH activity animations; model-specific extra actions are not inferred automatically.
- Electron adds a substantial install/download and idle-memory cost compared with the former in-page renderer, and its one-time binary download requires the profile-level `allowBuilds` authorization described above. The app does not embed DSH Web, uses SSE in steady state, and repaints only when a sprite frame changes to keep ongoing CPU/network work low.
- Unsigned development builds use Electron's generic executable identity. A separately packaged, signed desktop distribution would be required for a stable native application identity across install paths.

## License

[BSD-3-Clause](LICENSE)
