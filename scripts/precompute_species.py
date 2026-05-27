#!/usr/bin/env python
"""Generate bundled species assets for the standalone SPA build.

Runs from the repo root. Uses backend.config_io.load_stac_yaml to convert
each species' upstream stac-mjx YAML into the JSON shape the frontend
expects, and either copies the XML directly (when it has no asset deps)
or runs preprocess_meshful_xml.py to bake mesh→capsule replacements
in-place using each mesh's AABB.

Bundled species:
  - rat   (rodent_relaxed.xml + ACM demo data — Scott's precompute_assets.py)
  - stick (sungaya_inexpectata_box.xml + sungaya_inexpectata.yaml)
  - worm  (celegans.xml, mesh refs replaced)
  - mouse (mouse_with_meshes.xml, mesh refs replaced)
  - fly   (fruitfly_force.xml, mesh refs replaced)
"""
from __future__ import annotations
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.config_io import load_stac_yaml  # noqa: E402
from scripts.preprocess_meshful_xml import preprocess  # noqa: E402

OUT = REPO_ROOT / "frontend" / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)


def export_species(
    name: str,
    xml_src: Path,
    yaml_src: Path | None,
    *,
    has_meshes: bool = False,
) -> None:
    species_dir = OUT / name
    species_dir.mkdir(exist_ok=True)
    xml_dst = species_dir / xml_src.name

    if has_meshes:
        report = preprocess(xml_src, xml_dst)
        print(
            f"  XML: {xml_src.name} -> {xml_dst.relative_to(REPO_ROOT)} "
            f"(replaced {report['n_replaced']} mesh geoms: "
            f"{report['n_sphere']} sphere, {report['n_capsule']} capsule, "
            f"{report.get('n_ellipsoid', 0)} ellipsoid, "
            f"{report['out_bytes']:,} bytes)"
        )
    else:
        shutil.copy2(xml_src, xml_dst)
        print(f"  XML: {xml_src.name} -> {xml_dst.relative_to(REPO_ROOT)}")

    if yaml_src is None:
        print("  (no default config — researchers upload their own)")
        return

    loaded = load_stac_yaml(str(yaml_src))
    config_json = {
        "keypointModelPairs": dict(loaded["keypointModelPairs"]),
        "keypointInitialOffsets": loaded["keypointInitialOffsets"],
        "scaleFactor": float(loaded["scaleFactor"]),
        "mocapScaleFactor": float(loaded["mocapScaleFactor"]),
        "kpNames": list(loaded["kpNames"]),
    }
    cfg_dst = species_dir / "stac_config.json"
    cfg_dst.write_text(json.dumps(config_json, indent=2))
    print(f"  Config: {len(config_json['kpNames'])} kps -> {cfg_dst.relative_to(REPO_ROOT)}")


def main() -> None:
    handoff = REPO_ROOT.parent / "stick_handoff" / "data"
    stac_mjx = REPO_ROOT.parent / "stac-mjx"

    # Stick — clean XML, no mesh deps.
    print("stick:")
    export_species(
        "stick",
        xml_src=handoff / "sungaya_inexpectata_box.xml",
        yaml_src=handoff / "sungaya_inexpectata.yaml",
    )

    # Worm — mesh-heavy, preprocessor handles it.
    print("\nworm:")
    export_species(
        "worm",
        xml_src=stac_mjx / "models/celegans/celegans.xml",
        yaml_src=stac_mjx / "configs/model/celegans.yaml",
        has_meshes=True,
    )

    # Mouse — mesh-heavy.
    print("\nmouse:")
    export_species(
        "mouse",
        xml_src=stac_mjx / "models/mouse/mouse_with_meshes.xml",
        yaml_src=stac_mjx / "configs/model/mouse.yaml",
        has_meshes=True,
    )

    # Fly — mesh-heavy. fly_tethered config is the canonical default for
    # the force-actuated XML; fly_treadmill is for the ball model.
    print("\nfly:")
    export_species(
        "fly",
        xml_src=stac_mjx / "models/fruitfly/fruitfly_force.xml",
        yaml_src=stac_mjx / "configs/model/fly_tethered.yaml",
        has_meshes=True,
    )

    print("\nDone.")


if __name__ == "__main__":
    main()
