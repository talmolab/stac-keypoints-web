# Deploy guide

The app deploys as a static SPA to GitHub Pages. Every push to `main`
triggers `.github/workflows/deploy.yml`, which builds `frontend/dist`
and uploads it as the Pages artifact.

## Prerequisites

- The repo has GitHub Pages enabled with **Build and deployment → Source:
  GitHub Actions**. Set this in *Repository → Settings → Pages*. (If the
  setting reads "Deploy from a branch", switch it.)
- Branch protection isn't required, but the deploy workflow only fires on
  `main` so feature branches build via the CI workflow only.

## Workflows

`ci.yml` — runs on every PR and on `main`:
- `backend` job: installs the project on Python 3.12 and 3.13, runs pytest.
- `frontend` job: typechecks, builds, and runs vitest. The frontend job
  also installs Python because the parity tests shell out to it.

`deploy.yml` — runs on push to `main`:
- Build step: `npx vite build` with `GITHUB_PAGES=true` (so vite uses the
  correct `base` path).
- Deploy step: `actions/deploy-pages@v4` publishes `frontend/dist`.

## Bundled species assets

The frontend ships with five MuJoCo models bundled under
`frontend/public/data/<species>/`. They are *not* checked into git in
their final form — they're regenerated from upstream stac-mjx when
species change. Run:

```bash
python scripts/precompute_species.py
```

The script:
1. Copies clean XMLs (rat, stick) verbatim.
2. Runs `scripts/preprocess_meshful_xml.py` on mesh-heavy ones (mouse,
   worm, fly), producing a single-file XML with mesh geoms replaced by
   capsules (or spheres for short ones) sized from the original mesh
   AABBs.
3. Converts each species' upstream YAML to the JSON shape the frontend
   expects, via `backend.config_io.load_stac_yaml` (the canonical
   reference).

Inputs:
- Rat: `data/rodent_relaxed.xml` and `data/stac_rodent_acm.yaml`
- Stick: `~/stick_handoff/data/sungaya_inexpectata_box.xml` + `.yaml`
- Worm/mouse/fly: `../stac-mjx/models/*` and `../stac-mjx/configs/model/*`

If you need to add a species:
1. Place the source XML and stac-mjx YAML somewhere accessible.
2. Add an `export_species(...)` call in `precompute_species.py`.
3. Add an entry to the `BUNDLED` table in `frontend/src/localApi.ts`.
4. Run `python scripts/precompute_species.py` and rebuild the frontend.

## Mesh preprocessor

`scripts/preprocess_meshful_xml.py` is the standalone tool used by
`precompute_species.py`. It reads an XML with `<mesh file="...">` refs,
compiles through `mujoco.MjModel.from_xml_path` to populate `geom_aabb`,
then walks the XML with ElementTree to rewrite each mesh geom to a
capsule (or sphere). The output is loadable by `mj_loadXML` in the WASM
runtime — no asset directory needed.

Output sizes (worm 87 KB, fly 55 KB, mouse 152 KB) easily fit in the SPA
bundle compared to bundling the asset directories (tens of MB).

## Vite config

The `vite.config.ts` reads `GITHUB_PAGES` to set `base` to the repo path
(so asset URLs resolve under `https://<owner>.github.io/<repo>/`).
For the local dev server, `base` defaults to `/`.

## Environment variables (backend mode)

These are read by `backend/app.py`. They have defaults and are only needed
when running the Python backend.

| Var | Default | Purpose |
|-----|---------|---------|
| `MONSEES_RETARGET` | unset | Path to the lab-private `monsees-retarget` checkout. Required for ACM `.mat` autoload. |
| `STAC_KEYPOINTS_XML` | `data/rodent_relaxed.xml` | Initial XML on first launch. |
| `STAC_KEYPOINTS_CONFIG` | `data/stac_rodent_acm.yaml` | Initial config. |
| `STAC_KEYPOINTS_STAC_OUTPUT` | unset | Optional path to a precomputed STAC `.h5` to autoload. |
| `STAC_KEYPOINTS_ACM_TRIALS` | `3` | Number of ACM trials to load on autoload. |
| `STAC_XML_ROOTS` | unset | Extra directories scanned for the model dropdown's "Custom path" list. |

## Release artefacts

The same `frontend/dist/` that GitHub Pages serves can be zipped and
shipped as a release artefact for offline use. Researchers extract it
and serve via any static server (`python -m http.server`, `npx serve`,
etc.). All five bundled species work without internet access.

## Manual deploy

If GitHub Actions is unavailable, deploy by hand:

```bash
cd frontend
GITHUB_PAGES=true npx vite build
# upload dist/ to your hosting target
```

## Sanity checks after deploy

1. Open the deployed URL — `(species name) (bundled)` populates the model
   dropdown and the rat model renders.
2. Browser console has no `mj_loadXML` errors.
3. **Save** without uploading data should fail validation cleanly (not
   crash). With sample data loaded, the Save flow should prompt an FSA
   picker on Chrome/Edge and produce a download on Firefox/Safari.
4. The `backend not detected — running standalone` notice should be
   visible in the status bar (not a red error).
