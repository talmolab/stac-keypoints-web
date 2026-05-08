# Developer guide

## Repo layout

```
stac-keypoints-web/
├── backend/                    # FastAPI app (optional dependency at runtime)
│   ├── app.py                  # Routes
│   ├── config_io.py            # YAML load/dump (canonical reference)
│   ├── keypoints_io.py         # H5 / MAT loading (canonical reference)
│   ├── mujoco_utils.py         # Geom extraction, capsule fallback
│   └── stac_runner.py          # Procrustes alignment, Jacobian IK
├── frontend/
│   ├── public/data/<species>/  # Bundled XML + JSON config per species
│   ├── src/
│   │   ├── api.ts              # Smart-routing API: backend → localApi
│   │   ├── localApi.ts         # In-browser replacements (BUNDLED table)
│   │   ├── mujocoWasm.ts       # @mujoco/mujoco WASM wrapper
│   │   ├── h5KeypointsLoader.ts  # h5wasm-based browser-side loader
│   │   ├── yamlConfig.ts       # js-yaml-based browser-side YAML I/O
│   │   ├── exportConfig.ts     # FSA save-in-place + blob fallback
│   │   ├── qualityReport.ts    # Quality report builder + export
│   │   ├── store.ts            # Zustand store (persisted)
│   │   ├── components/         # React UI
│   │   └── __tests__/          # Vitest parity + unit tests
├── scripts/
│   ├── precompute_species.py   # Generates frontend/public/data/*
│   └── preprocess_meshful_xml.py # Mesh → capsule XML rewriter
├── data/                       # Demo datasets, default rodent assets
├── tests/                      # Backend pytest suite
└── .github/workflows/          # CI + GH Pages deploy
```

## Dual-mode architecture

The frontend is the same build whether the backend is running or not. The
trick is `frontend/src/api.ts`: every API call first probes the backend
(once, cached) via `backendOk()`. If reachable it goes through the FastAPI
route; otherwise it falls back to the in-browser `localApi.ts` equivalent.

```ts
export async function loadXml(path: string) {
  if (!(await backendOk())) return local.loadXml(path);
  // ...fetch from backend
}
```

Calls split into three buckets:

| Class | Examples | Standalone behaviour |
|-------|----------|----------------------|
| Pure I/O | `loadXml`, `loadConfig`, `uploadKeypoints`, `exportConfig` | Re-implemented in `localApi.ts` |
| Pure compute (cheap) | `bodyTransforms`, Procrustes alignment | Re-implemented via mujocoWasm + JS |
| Heavy compute | Jacobian IK preview, ACM `.mat` loading via monsees-retarget | Falls back to "no-op" or asks for backend |

The bundled-species table lives in `localApi.ts`:
```ts
const BUNDLED: BundledSpecies[] = [
  { name: "rat (bundled, with demo)", xmlPath: "data/rat/rodent_relaxed.xml", ... },
  ...
];
```
Adding a species means: drop new files under `frontend/public/data/<name>/`,
extend `BUNDLED`, regenerate via `scripts/precompute_species.py`.

## State management

Zustand store in `store.ts`. The `persist` middleware writes a
`partialize`d slice to `localStorage`. Anything user-authored (mappings,
offsets, segment scales) is persisted; transient state (alignment buffers,
IK status) is not.

`merge` rehydrates `Set<number>` (frame labels) from the JSON-array form.

## Running locally

```bash
# Backend (Python 3.12+)
pip install -e ".[dev]"
uvicorn backend.app:app --reload --port 8000

# Frontend (Node 22)
cd frontend
npm install
npm run dev   # http://localhost:5173
```

Or both at once: `./start.sh` (uses tmux, configurable via env vars).

## Testing

### Backend
```bash
pytest --ignore=tests/test_acm_processing.py -v
```
The ACM tests need the lab-private `monsees-retarget` package; CI skips
them. Locally, install monsees-retarget and unset the ignore.

### Frontend
```bash
cd frontend
npm test           # vitest run
npm run test:watch # vitest --watch
```

The tests in `frontend/src/__tests__/` shell out to `python3` to run the
backend's `config_io.py` and `keypoints_io.py` as canonical references,
then compare results against the JS ports. This catches subtle drift —
for example `f"{0.0}"` (Python) vs `${0.0}` (JS) producing different YAML.

CI runs the same suite against a fresh backend install on every PR.

## Adding a feature: checklist

1. Implement against the backend (in `backend/`) when it makes sense to
   run on Python — for example, anything that needs `mujoco` Python or
   numpy/scipy.
2. Re-implement in `frontend/src/localApi.ts` (or a sibling module) so
   standalone mode keeps parity. Use `await import(...)` for heavy deps
   like `h5wasm` so the main bundle stays lean.
3. Add `frontend/src/__tests__/` parity test that round-trips the JS port
   through Python and asserts byte-for-byte equivalence (or
   numerical equivalence within an epsilon).
4. Run `npm run build` — the production build is what GH Pages serves,
   and tsc errors that vitest's transpiler tolerates will fail it.

## Mesh preprocessor

`scripts/preprocess_meshful_xml.py` reads an XML with `<mesh file="...">`
geoms, compiles it through `mujoco.MjModel.from_xml_path` to populate
`geom_aabb`, then walks the original XML with ElementTree and replaces each
mesh geom with a capsule sized from the AABB (or a sphere if the cylinder
portion would be < 30% of the radius). The resulting single-file XML is
loadable by the WASM runtime, which has no asset directory.

This catches both `type="mesh"` geoms and class-inherited mesh types
(fly's geoms inherit type via `<default class="...">`). The class
attribute is stripped on the rewrite so the default doesn't reassert
`type="mesh"`.

The output XMLs are 50–150 KB — small enough to bundle, faithful enough
for keypoint mapping. See `scripts/precompute_species.py` for the
species batch driver and `docs/deploy.md` for the build-time invocation.

## Coding conventions

- TypeScript strict mode, no `any` outside narrow interop edges
  (FSA types, dynamic imports).
- React functional components only; Zustand for shared state.
- Comments explain *why*, not *what*. Mention surprises (the float32
  edge case in `qualityReport`) inline; don't recap obvious code.
- Match the Python backend's data shapes when porting: positions are
  Float32Array of length `numFrames * numKeypoints * 3`, NaN means
  "missing", confidences are `numFrames * numKeypoints`.

## Common gotchas

- **WASM module externalised warnings** — Vite logs a warning that
  `module` is externalised when bundling `@mujoco/mujoco`. Harmless;
  the runtime never imports the Node `module` builtin.
- **`spawnSync` truncation** — when adding parity tests that produce
  large JSON, set `maxBuffer: 1024 * 1024 * 1024`. The default 1 MB
  silently truncates and you get an inscrutable empty-stderr failure.
- **`tsconfig.json` excludes `__tests__`** — tests use Node-only APIs
  (`spawnSync`, `mkdtempSync`); the production build can't see them.
  Vitest has its own resolver and finds them anyway.
