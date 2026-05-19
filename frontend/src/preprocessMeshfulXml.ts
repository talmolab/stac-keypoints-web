// Browser-side port of scripts/preprocess_meshful_xml.py.
//
// Stages a user-supplied meshful MJCF + its mesh files in MEMFS, compiles
// via mj_loadXML to read each mesh geom's compile-time AABB, then rewrites
// the XML in place — replacing every <geom mesh="…" /> with a capsule (or
// sphere when the cylinder portion would be sub-µm) and stripping
// <asset><mesh /></asset> entries plus <compiler meshdir="…"> so the
// rewritten XML can be loaded standalone with no asset deps.
//
// Algorithm + thresholds match the Python preprocessor exactly. Quat math
// is reimplemented in JS to keep the pure rewriter free of WASM, so it can
// be unit-tested with synthetic AABBs without compiling a real model.

import { initMuJoCo, getMjModule } from "./mujocoWasm";

const CAPSULE_MIN_CYL_RATIO = 0.3;
const CAPSULE_MIN_CYL_ABS = 1e-5;

type Quat = [number, number, number, number]; // (w, x, y, z), MuJoCo convention
type Vec3 = [number, number, number];

export interface Aabb6 {
  center: Vec3;
  half: Vec3;
}

export interface PreprocessReport {
  nReplaced: number;
  nSphere: number;
  nCapsule: number;
  outBytes: number;
}

// Python's f"{v:.6g}" — at most 6 sig figs, trailing zeros dropped.
// Number(toPrecision(6)) round-trips to the minimal short decimal form.
function fmt(n: number): string {
  if (n === 0) return "0";
  return String(Number(n.toPrecision(6)));
}

function quatRotateVec(q: Quat, v: Vec3): Vec3 {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

function quatMul(a: Quat, b: Quat): Quat {
  const aw = a[0], ax = a[1], ay = a[2], az = a[3];
  const bw = b[0], bx = b[1], by = b[2], bz = b[3];
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

function meshGeomAttrs(aabb: Aabb6, pos0: Vec3, quat0: Quat): Record<string, string> {
  const [hx, hy, hz] = aabb.half;
  const extents = [hx, hy, hz];
  let longest = 0;
  if (extents[1] > extents[longest]) longest = 1;
  if (extents[2] > extents[longest]) longest = 2;
  const halfLong = extents[longest];
  let halfShort = 0;
  for (let i = 0; i < 3; i++) {
    if (i !== longest && extents[i] > halfShort) halfShort = extents[i];
  }
  const cyl = halfLong - halfShort;

  const rot = quatRotateVec(quat0, aabb.center);
  const newPos: Vec3 = [pos0[0] + rot[0], pos0[1] + rot[1], pos0[2] + rot[2]];
  const out: Record<string, string> = {
    pos: `${fmt(newPos[0])} ${fmt(newPos[1])} ${fmt(newPos[2])}`,
  };

  if (
    halfShort < 1e-9 ||
    cyl < CAPSULE_MIN_CYL_RATIO * halfShort ||
    cyl < CAPSULE_MIN_CYL_ABS
  ) {
    out.type = "sphere";
    out.size = fmt(Math.max(halfShort, 1e-5));
    return out;
  }

  const sqrtHalf = Math.sqrt(0.5);
  // Quat that takes the model's longest-axis (Z by default) onto the
  // longest extent of the AABB. Matches the Python script's `align` table.
  const aligns: Quat[] = [
    [sqrtHalf, 0, sqrtHalf, 0],   // Z → X
    [sqrtHalf, -sqrtHalf, 0, 0],  // Z → Y
    [1, 0, 0, 0],                 // Z → Z
  ];
  const combined = quatMul(quat0, aligns[longest]);
  out.type = "capsule";
  out.size = `${fmt(halfShort)} ${fmt(cyl)}`;
  out.quat = `${fmt(combined[0])} ${fmt(combined[1])} ${fmt(combined[2])} ${fmt(combined[3])}`;
  return out;
}

function isMeshGeom(geom: Element): boolean {
  // A geom is mesh-typed if it explicitly says so or has a mesh="…" ref
  // (which forces the type even when inherited via <default>).
  return geom.getAttribute("type") === "mesh" || geom.hasAttribute("mesh");
}

function parseTriple(s: string | null, fallback: Vec3): Vec3 {
  if (!s) return fallback;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return fallback;
  return [parts[0], parts[1], parts[2]];
}
function parseQuad(s: string | null, fallback: Quat): Quat {
  if (!s) return fallback;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return fallback;
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** Pure XML rewriter — given AABB queues keyed by parent-body name (in
 *  document order, matching MuJoCo's compile-time geom order), rewrites
 *  mesh geoms and strips mesh assets / meshdir. Exposed for testing.
 *  Production callers should use preprocessMeshfulXml. */
export function rewriteXml(
  xmlText: string,
  queues: Map<string, Aabb6[]>,
): { xml: string; report: PreprocessReport } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const root = doc.documentElement;
  let nReplaced = 0;
  let nSphere = 0;

  function walkBody(body: Element, name: string): void {
    for (const g of Array.from(body.children).filter((c) => c.tagName === "geom")) {
      if (!isMeshGeom(g)) continue;
      const queue = queues.get(name);
      if (!queue || queue.length === 0) continue;
      const aabb = queue.shift()!;
      const pos0 = parseTriple(g.getAttribute("pos"), [0, 0, 0]);
      const quat0 = parseQuad(g.getAttribute("quat"), [1, 0, 0, 0]);
      const attrs = meshGeomAttrs(aabb, pos0, quat0);
      for (const a of ["mesh", "fitscale", "type", "class"]) g.removeAttribute(a);
      for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v);
      nReplaced++;
      if (attrs.type === "sphere") nSphere++;
    }
    for (const child of Array.from(body.children).filter((c) => c.tagName === "body")) {
      walkBody(child, child.getAttribute("name") || "");
    }
  }

  const worldbody = root.getElementsByTagName("worldbody")[0];
  if (worldbody) {
    for (const body of Array.from(worldbody.children).filter((c) => c.tagName === "body")) {
      walkBody(body, body.getAttribute("name") || "");
    }
  }

  for (const asset of Array.from(root.getElementsByTagName("asset"))) {
    for (const m of Array.from(asset.getElementsByTagName("mesh"))) {
      m.parentNode?.removeChild(m);
    }
    if (asset.children.length === 0) asset.parentNode?.removeChild(asset);
  }
  for (const comp of Array.from(root.getElementsByTagName("compiler"))) {
    comp.removeAttribute("meshdir");
  }

  const xml = new XMLSerializer().serializeToString(doc);
  return {
    xml,
    report: {
      nReplaced,
      nSphere,
      nCapsule: nReplaced - nSphere,
      outBytes: xml.length,
    },
  };
}

/** Stage XML + assets in MEMFS at /scratch, compile via mj_loadXML to
 *  read each mesh geom's compile-time AABB, dispose, then rewrite the
 *  XML. Returns a mesh-less MJCF that can be loaded standalone.
 *
 *  Staging dir is rebuilt fresh on every call — Emscripten's MEMFS
 *  persists writes across mj_loadXML calls, so without cleanup a second
 *  upload of a model whose meshdir-relative paths collide with the first
 *  upload's would silently read stale bytes. */
export async function preprocessMeshfulXml(
  xmlText: string,
  assets: Map<string, Uint8Array>,
): Promise<{ xml: string; report: PreprocessReport }> {
  await initMuJoCo();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mj: any = getMjModule();
  const SCRATCH = "/scratch";

  cleanupScratch(mj, SCRATCH);
  try { mj.FS.mkdir(SCRATCH); } catch (_) { /* exists */ }

  function ensureDir(rel: string): void {
    const parts = rel.split("/");
    let cur = SCRATCH;
    for (let i = 0; i < parts.length - 1; i++) {
      cur += "/" + parts[i];
      try { mj.FS.mkdir(cur); } catch (_) { /* exists */ }
    }
  }
  for (const [path, bytes] of assets) {
    if (!path) continue;
    const safe = path.replace(/^\/+/, "");
    ensureDir(safe);
    mj.FS.writeFile(`${SCRATCH}/${safe}`, bytes);
  }
  mj.FS.writeFile(`${SCRATCH}/model.xml`, xmlText);

  let model: any = null;
  try {
    model = mj.MjModel.mj_loadXML(`${SCRATCH}/model.xml`);
    const queues = collectAabbs(mj, model);
    return rewriteXml(xmlText, queues);
  } finally {
    if (model) model.delete();
    cleanupScratch(mj, SCRATCH);
  }
}

/** Recursively unlink everything under `dir`, then rmdir `dir` itself.
 *  Best-effort — if `dir` doesn't exist (first call) the readdir throws
 *  and we silently bail. Skips the `.` and `..` entries Emscripten
 *  includes in readdir output. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function cleanupScratch(mj: any, dir: string): void {
  let entries: string[];
  try { entries = mj.FS.readdir(dir); } catch (_) { return; }
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    const path = `${dir}/${name}`;
    const stat = mj.FS.stat(path);
    // S_IFDIR = 0o040000 — Emscripten honours POSIX mode bits.
    if ((stat.mode & 0o170000) === 0o040000) cleanupScratch(mj, path);
    else mj.FS.unlink(path);
  }
  try { mj.FS.rmdir(dir); } catch (_) { /* race or non-empty — drop */ }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function collectAabbs(mj: any, model: any): Map<string, Aabb6[]> {
  const MESH_TYPE = mj.mjtGeom.mjGEOM_MESH.value;
  const decoder = new TextDecoder("utf-8");
  const namesArray = new Uint8Array(model.names);
  const readBodyName = (b: number): string => {
    const adr = model.name_bodyadr[b];
    let end = adr;
    while (end < namesArray.length && namesArray[end] !== 0) end++;
    return decoder.decode(namesArray.subarray(adr, end));
  };

  const queues = new Map<string, Aabb6[]>();
  for (let g = 0; g < model.ngeom; g++) {
    if (model.geom_type[g] !== MESH_TYPE) continue;
    const bid = model.geom_bodyid[g];
    const name = readBodyName(bid);
    const a: Aabb6 = {
      center: [model.geom_aabb[g * 6 + 0], model.geom_aabb[g * 6 + 1], model.geom_aabb[g * 6 + 2]],
      half:   [model.geom_aabb[g * 6 + 3], model.geom_aabb[g * 6 + 4], model.geom_aabb[g * 6 + 5]],
    };
    if (!queues.has(name)) queues.set(name, []);
    queues.get(name)!.push(a);
  }
  return queues;
}
