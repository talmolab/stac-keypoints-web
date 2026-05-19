# Known issues and future directions

Snapshot of what works, what's deferred, and where to take the project
next. Written at the M6 handoff so the lab team can pick up without
re-deriving context.

## Status at handoff

- Backend mode is fully featured: ACM `.mat` loading, Procrustes
  alignment, Jacobian IK preview, batched body transforms, YAML round-trip.
- Standalone (SPA) mode covers everything except IK preview and ACM
  loading. Mapping, offsets, alignment math, YAML export, quality report —
  all run in the browser.
- Five species bundled and verified end-to-end (rat, stick, worm, mouse,
  fly). Each has a JSON config and a single-file XML in
  `frontend/public/data/`.
- CI green on `main`: backend pytest + frontend typecheck/build/vitest.
- GH Pages auto-deploy on push to `main`.

## Known limitations

### Standalone-only limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| No IK preview in standalone | Researchers can't see live solved-pose error before running STAC | Run the FastAPI backend locally (1 command), or run STAC on the GPU box and load the H5 back |
| No ACM trial loader in standalone | Monsees `.mat` files load OK, but the multi-trial autoload path is backend-only because it depends on `monsees-retarget` (lab-private) | Backend mode for ACM-pipeline researchers; everyone else uses Load KP / Load .mat |
| `Custom path…` is backend-only | The model dropdown's free-form file path entry only works against the FastAPI backend | Use one of the five bundled species, or extend `BUNDLED` (see developer-guide.md) |

### Mesh-rendering fidelity

Bundled mouse, worm, and fly XMLs use capsules/spheres in place of the
original meshes (preprocessor output). This is faithful for keypoint
mapping — bodies are easy to identify and click on — but visually
coarser than the `BufferGeometry`-from-`mesh_vert`/`mesh_face` path that
M5 deferred. If a researcher needs higher visual fidelity (e.g. for
publication figures), revisit by:
- Reading mesh `vert`/`face` arrays from MuJoCo at WASM init
- Building three.js `BufferGeometry` per geom
- Falling back to capsules when no mesh data (current path)

### Data-format coverage

`.h5` (SLEAP and stac-mjx layouts) and `.mat` (v7.3 / HDF5) work in
both modes. `.nwb` is **not** wired up — the original M6 plan asked
"defer .nwb / .mat to follow-up vs. include now"; we shipped `.mat`,
deferred `.nwb`. If researchers ask for it, add a sibling loader in
`frontend/src/h5KeypointsLoader.ts` that reads the relevant NWB groups
via `pynwb` semantics. The bottleneck is figuring out where keypoints
live in NWB; the file format is already HDF5 underneath, so `h5wasm`
handles it.

### Quick STAC preview (open question)

Scott's prototype branch had a Jacobian-IK proxy ("Quick STAC") that
previewed registration quality without the full STAC pipeline. M6
preserved the placeholder but the open question — keep it, drop it, or
stub a remote-backend call — is **blocked on the Wednesday meeting
(2026-05-13 with Talmo and Scott)**. Three plausible answers:

1. **Keep Jacobian-IK proxy** as M5 had it. Cheap to maintain. Risk:
   researchers misinterpret proxy output as final-quality STAC.
2. **Drop entirely.** Researchers run STAC on GPU box anyway; the
   preview is misleading. Saves ~400 LOC and a maintenance headache.
3. **Remote backend stub.** Send the YAML to a hosted STAC service
   (URL in env var, configurable per deployment), get the H5 back,
   visualise. Adds infra dependency.

The roadmap defaults to (1) until that meeting decides otherwise.

### User-upload texture handling (open question)

The "Load XML folder…" path runs `preprocessMeshfulXml` on user uploads, which strips `<asset><mesh /></asset>` entries and replaces every mesh geom with a capsule/sphere. Textures (`<asset><texture file="…" />`) are not stripped or rewritten — if a model references textures, the user must include the texture files in the upload, otherwise `mj_loadXML` rejects the model. **Question for the Wednesday meeting (2026-05-13)**: how do we want to handle textured user uploads?

1. **Status quo.** User must upload textures alongside meshes. Simple, but
   a sharp edge for new users; the error message points at MuJoCo's
   compile error rather than explaining the texture requirement.
2. **Strip textures too.** Replace textured materials with a flat-color
   default in the preprocessor. Matches the bundled-species behaviour
   (which is already untextured), keeps uploads to "XML + meshes only".
3. **Bake textures.** Read texture PNGs in JS, sample to a flat average
   color per material, write that color back as `rgba`. Closer to (2)
   but preserves perceived material variety. ~1 day of work.

Default until the meeting decides: **(1) status quo**, with a clearer
error message ("XML references textures — include the .png files in the
upload, or remove `<texture>` refs"). Tracked here so we don't quietly
ship (2) or (3) without alignment.

### Browser support

- **Chrome/Edge**: full support including FSA save-in-place. Recommended.
- **Firefox**: works except FSA — every save downloads a file. No
  showSaveFilePicker, no in-place writes.
- **Safari**: limited FSA, otherwise OK. Safari is occasionally fussy
  about `SharedArrayBuffer`-using WASM modules; if MuJoCo init fails on
  Safari, check the COOP/COEP headers on your hosting.

### Performance

- Datasets up to ~210k frames work in standalone mode through dynamic
  h5wasm loading. The bottleneck shifts from JSON wire size (M5) to
  the in-browser Float32Array allocations.
- The MuJoCo WASM runtime is single-threaded; nothing forces
  multi-threaded builds yet.
- Bundle size: main app 340 KB gz; lazy mujoco chunk 35 KB gz; lazy
  h5wasm chunk 1029 KB gz (loaded only when a user opens an H5 file).

## Future directions

### Short-term (one researcher week each)

- **Wire up `.nwb`** if the lab needs it. Pattern is identical to the
  `.mat` reader, just different group structure.
- **Per-frame quality timeline** — extend the existing gap heatmap to
  show per-frame error once IK has run, so researchers can spot
  problem segments before exporting.
- **Body-tree filter on mesh geoms** — the preprocessor currently
  bundles every body. Some species (mouse) have ~230 bodies; filtering
  to the keypoint-mapped subset would shave bundle size by ~30%.

### Medium-term

- **Remote STAC backend** (decision pending). Either as a Modal /
  Beam.cloud / Talmolab-hosted service, with the URL configurable per
  deployment. The current `localApi.ts` fallback pattern would extend
  to "local → remote → null" cleanly.
- **Real mesh rendering** for non-rat species (the deferred M5 item).
  Big enough to run as a standalone task; ~1–2 weeks if you also handle
  the texturing surface.
- **Project / session manager** — multi-dataset, multi-config in one
  browser session. Currently each load wipes the previous; researchers
  juggling several animals would want tabs or per-dataset state buckets.

### Long-term

- **Tauri shell** for offline-first installations (the original Rust/Tauri
  question from M6 planning). Same React+WASM build, packaged as a
  desktop app for institutions where browsers can't reach external
  WASM CDNs.
- **Programmatic API** — expose the YAML export and Procrustes alignment
  as a JS library so other talmolab tools can embed them.

## Maintenance hot spots

Files that are most likely to bite future maintainers:

- `frontend/src/yamlConfig.ts` `pyFloatStr()` — Python's `f"{0.0}"` is
  `"0.0"`, JS's template literal is `"0"`. Tests catch drift; *don't*
  "simplify" this.
- `scripts/preprocess_meshful_xml.py` `_is_mesh_geom()` — must catch
  both `type="mesh"` and `mesh="..."` attributes (class-inherited types).
- `frontend/src/api.ts` `backendOk()` cache — the per-call probe is
  cached for the page lifetime. If you start the backend mid-session,
  refresh the page to re-probe.
- `frontend/tsconfig.json` excludes `__tests__` — adding test files
  outside that path will break the production build (Node-only APIs).

## Contacts

- Talmo Pereira (talmo@salk.edu) — overall direction, acceptance criteria.
- Scott Yang — original SPA prototype (`upstream/scott/deploy_to_gh_page`).
- Hugo Farajallah (hugo.farajallah@unige.ch) — M3–M6 implementation,
  available for handoff questions through the contract end date.
