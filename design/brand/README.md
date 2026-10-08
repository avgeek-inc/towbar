# Towbar brand source

`Towbar.sketch` is the source document for Towbar branding. It contains the
container-only Towbar mark, Scout Agent artwork,
transparent and opaque variants, favicon compositions, and the Open Graph card.

The PNGs in `exports/` are native Sketch exports. The symbol exports use a scale
of 2.56 from their 400px artboards, producing 1024 × 1024 assets. Sketch labels
these files `@2x`; their actual size is 1024px. The small favicon uses a scale of
0.16, producing 64 × 64 pixels. Open Graph is exported at 1×, or 1200 × 630.

| Sketch artwork                   | Published copies                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `towbar_light_transparent`       | `apps/towbar-web-app/public/brand/towbar-logo.png`, `docs/assets/towbar-logo.png`       |
| `towbar_favicon` at 64px         | `apps/towbar-web-app/public/brand/towbar-favicon.png`, `docs/assets/towbar-favicon.png` |
| `towbar_scout_light_transparent` | `apps/towbar-web-app/public/scout/mascot.png`, `docs/assets/scout/mascot.png`           |
| `OpenGraph`                      | `docs/assets/towbar-og.png`, `docs/assets/towbar-open-graph.png`                        |

The light and dark transparent logo exports are identical, so the app and docs
share one transparent logo in both appearances. README branding, service logos,
email branding and documentation metadata resolve to these published copies.
The existing close-up Scout sidebar icon and contextual illustrations remain
separate artwork.

To export an updated symbol with Sketch installed, run from the repository root:

```sh
/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool export layers design/brand/Towbar.sketch --item=towbar_light_transparent --formats=png --scales=2.56 --output=design/brand/exports --overwriting=YES
```

Use the same command with `--item=towbar_favicon --scales=0.16` for the browser
favicon, or `--item=OpenGraph --scales=1` for the social card. Copy the resulting
exports to the paths above. Preserve the transparent alpha channel and the
artboard framing rather than trimming or resizing the artwork manually.
