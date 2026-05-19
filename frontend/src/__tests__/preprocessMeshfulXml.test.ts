// @vitest-environment happy-dom
//
// Unit tests for the pure XML rewriter half of preprocessMeshfulXml.
// The WASM-bound aabb-collection step is tested manually in the browser
// (covered by the bundled species build, which has parity with the Python
// preprocessor since both produce the post-processed XMLs in the deploy
// bundle).

import { describe, it, expect } from "vitest";
import { rewriteXml, type Aabb6 } from "../preprocessMeshfulXml";

describe("rewriteXml", () => {
  it("replaces a long-axis mesh geom with a capsule", () => {
    const xml = `<?xml version="1.0"?>
<mujoco>
  <compiler meshdir="meshes"/>
  <asset>
    <mesh name="leg" file="leg.obj"/>
  </asset>
  <worldbody>
    <body name="thigh">
      <geom mesh="leg" type="mesh" pos="0 0 0"/>
    </body>
  </worldbody>
</mujoco>`;
    // Long axis = X (hx > hy, hz). Cylinder portion = 0.10 - 0.02 = 0.08,
    // well above the 0.3 * 0.02 = 0.006 cyl-ratio threshold → capsule.
    const queues = new Map<string, Aabb6[]>([
      ["thigh", [{ center: [0.05, 0, 0], half: [0.10, 0.02, 0.02] }]],
    ]);
    const { xml: out, report } = rewriteXml(xml, queues);
    expect(report.nReplaced).toBe(1);
    expect(report.nCapsule).toBe(1);
    expect(report.nSphere).toBe(0);
    expect(out).toMatch(/type="capsule"/);
    expect(out).not.toMatch(/type="mesh"/);
    expect(out).not.toMatch(/mesh="leg"/);
    // pos shifted by aabb center (0.05, 0, 0) rotated by identity quat → (0.05, 0, 0)
    expect(out).toMatch(/pos="0\.05 0 0"/);
    // size = halfShort, cyl
    expect(out).toMatch(/size="0\.02 0\.08"/);
  });

  it("falls back to sphere when cylinder portion is sub-threshold", () => {
    const xml = `<mujoco><worldbody><body name="head">
      <geom mesh="ball" type="mesh"/>
    </body></worldbody></mujoco>`;
    // Roughly equal extents → cyl ≈ 0, below ratio threshold → sphere.
    const queues = new Map<string, Aabb6[]>([
      ["head", [{ center: [0, 0, 0], half: [0.05, 0.049, 0.05] }]],
    ]);
    const { xml: out, report } = rewriteXml(xml, queues);
    expect(report.nSphere).toBe(1);
    expect(report.nCapsule).toBe(0);
    expect(out).toMatch(/type="sphere"/);
    expect(out).toMatch(/size="0\.05"/);
    expect(out).not.toMatch(/quat=/);   // sphere has no orientation
  });

  it("strips <asset><mesh /> entries and meshdir, keeps other compiler attrs", () => {
    const xml = `<mujoco>
  <compiler meshdir="meshes" angle="degree"/>
  <asset>
    <mesh name="m1" file="a.obj"/>
    <texture name="tex" file="t.png"/>
  </asset>
  <worldbody><body name="b"><geom type="sphere" size="0.1"/></body></worldbody>
</mujoco>`;
    const { xml: out } = rewriteXml(xml, new Map());
    expect(out).not.toMatch(/<mesh /);
    expect(out).toMatch(/<texture/);          // non-mesh assets preserved
    expect(out).not.toMatch(/meshdir=/);
    expect(out).toMatch(/angle="degree"/);    // other compiler attrs preserved
  });

  it("removes <asset> entirely if it had only mesh children", () => {
    const xml = `<mujoco><asset><mesh name="m" file="a.obj"/></asset><worldbody/></mujoco>`;
    const { xml: out } = rewriteXml(xml, new Map());
    expect(out).not.toMatch(/<asset/);
  });

  it("walks nested bodies in document order", () => {
    const xml = `<mujoco><worldbody>
      <body name="root">
        <geom mesh="m1" type="mesh"/>
        <body name="child">
          <geom mesh="m2" type="mesh"/>
        </body>
      </body>
    </worldbody></mujoco>`;
    const queues = new Map<string, Aabb6[]>([
      ["root",  [{ center: [0, 0, 0], half: [0.10, 0.02, 0.02] }]],
      ["child", [{ center: [0, 0, 0], half: [0.05, 0.05, 0.10] }]],
    ]);
    const { report } = rewriteXml(xml, queues);
    expect(report.nReplaced).toBe(2);
    expect(report.nCapsule).toBe(2);
  });

  it("respects implicit mesh typing from a mesh= attr only", () => {
    // No type="mesh" attr — the algorithm must still treat it as mesh
    // because mesh="…" forces the type even when inherited via <default>.
    const xml = `<mujoco><worldbody><body name="b">
      <geom mesh="m"/>
    </body></worldbody></mujoco>`;
    const queues = new Map<string, Aabb6[]>([
      ["b", [{ center: [0, 0, 0], half: [0.10, 0.02, 0.02] }]],
    ]);
    const { report, xml: out } = rewriteXml(xml, queues);
    expect(report.nReplaced).toBe(1);
    expect(out).not.toMatch(/mesh="m"/);
  });

  it("aligns long axis Y → quat picks the Z→Y rotation", () => {
    const xml = `<mujoco><worldbody><body name="b">
      <geom mesh="m" type="mesh"/>
    </body></worldbody></mujoco>`;
    // halfY is largest → longest=1 → align quat = (sqrt(0.5), -sqrt(0.5), 0, 0)
    const queues = new Map<string, Aabb6[]>([
      ["b", [{ center: [0, 0, 0], half: [0.02, 0.10, 0.02] }]],
    ]);
    const { xml: out } = rewriteXml(xml, queues);
    const sqrtHalf = Math.sqrt(0.5);
    const expected = `quat="${Number(sqrtHalf.toPrecision(6))} ${Number((-sqrtHalf).toPrecision(6))} 0 0"`;
    expect(out).toContain(expected);
  });
});
