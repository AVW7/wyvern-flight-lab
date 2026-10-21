# Sanctuary Blender-to-GLB Production & Export Recipe

This document defines the strict authoring, surfacing, geometry, transform, and export standards for creating or modifying static sanctuary models in Blender for export to `public/models/sanctuary.glb`.

---

## 1. Scene & Unit Contract

| Property | Value | Rule & Justification |
|---|---|---|
| **Unit System** | Metric | $1.0\text{ Blender Unit} = 1.0\text{ Metre}$. Never author in centimetres ($0.01$) or inches. |
| **Coordinate System** | $+Y$ Up, $-Z$ Forward | Standard Three.js / glTF convention. $+X$ is Right. |
| **Pivot Origin** | Ground Base & Center | Bounding box centered at $X=0, Z=0$; resting directly on $Y=0$ (ground plane). |
| **Object Names** | Semantic Id | Name root mesh object exactly as its logical id (e.g. `prop.barracks.quarters`, `prop.infirmary.canopy`). |

---

## 2. Geometry & Topology Standards

1. **Applied Transforms:**
   - Always run `Object -> Apply -> All Transforms` (`Ctrl+A`) before export.
   - Translation $= [0, 0, 0]$, Rotation $= [0, 0, 0]$, Scale $= [1.0, 1.0, 1.0]$.
2. **Beveled Edges & Joinery:**
   - Do not leave razor-sharp CG edges on timber or stone. Use $1.5\text{cm} - 3.0\text{cm}$ bevels or chamfers.
   - Use `Weighted Normal` modifier or `Auto Smooth` (30°–45° angle) for crisp mechanical highlights.
3. **Overlaps & Caps:**
   - Ensure all open pipes, timber posts, and masonry seams have solid end caps and contact geometry.
   - Avoid zero-thickness single-sided polygons unless designated for leaf cards.
4. **Polygon Targets:**
   - Hero structures (Keep Gate, Hatchery Arch, Forge Pavilion): $15\text{k} - 30\text{k}$ triangles.
   - Functional props (Anvil, Trough, Bunk, Rack, Nest): $2\text{k} - 8\text{k}$ triangles.
   - Small scatter / decor (Rocks, Grass, Clutter): $\le 1\text{k}$ triangles.

---

## 3. Materials & Surfacing Pipeline

1. **Shader Engine:**
   - Use standard `Principled BSDF` node.
   - Disallowed nodes: Vertex Color overrides, procedural noise/voronoi textures without baking, ray-tracing subsurface nodes.
2. **Channel Packing & PBR Rules:**
   - **Metallic:** Categorical ($0.0$ for stone, timber, hide, earth; $1.0$ for forged iron, steel, bronze).
   - **Roughness:** Carries the primary material character ($0.35 - 0.50$ for polished iron; $0.80 - 0.95$ for stone and earth).
   - **Base Color:** sRGB color space.
3. **Texture Atlas Sharing:**
   - Single shared palette texture (`PP_Color_Palette.png` or $1024 \times 1024$ shared atlas).
   - Ensure UVs are strictly mapped to corresponding palette swatch coordinates.

---

## 4. Sockets & Metadata Anchors

Add empty objects (`Plain Axes`) parented to the main mesh to define named interaction anchors:
- `socket.playerApproach`: Position in front of the object where the player character walks to before interacting.
- `socket.interaction`: Center of manual focus (e.g. table surface, anvil strike face).
- `socket.wyvernPerch`: Landing contact point for adult or adolescent wyverns.
- `socket.effect`: Origin for particle emitters (e.g. spark burst, steam plume, smoke plume).
- `socket.light`: Origin for point lights (e.g. torch flame, hearth ember).

---

## 5. Blender Export Settings (`.glb`)

When exporting from Blender via `File -> Export -> glTF 2.0 (.glb)`:

- **Format:** `glTF Binary (.glb)`
- **Include:**
  - Selected Objects: `True` (or active collection)
  - Custom Properties: `True`
  - Cameras: `False`
  - Punctual Lights: `False`
- **Transform:**
  - $+Y$ Up: `True`
- **Geometry:**
  - Apply Modifiers: `True`
  - UVs: `True`
  - Normals: `True`
  - Tangents: `False` (unneeded for palette materials without normal maps; saves 25% vertex payload)
  - Colors: `False`
- **Animation:**
  - Animation: `False` (for static scenery props)
  - Skinning: `False`

---

## 6. Build & Gate Commands

After exporting your asset or rebuilding the atlas:

```bash
# 1. Validate the atlas against sanctuary-library.json
pnpm assets:validate-sanctuary-atlas

# 2. Inspect true scale, bounds, and sockets in the browser
# Open: http://localhost:3000/sanctuary-props

# 3. Run repository gates
pnpm typecheck && pnpm lint && pnpm test
```
