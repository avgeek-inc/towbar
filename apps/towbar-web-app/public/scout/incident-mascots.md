# Overview illustrations

## Current assets

| Widget or state     | File                              | Subject                                                                        |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Apps                | `overview-apps-charcoal.png`      | Gray containers with a yellow Docker emblem                                    |
| Resources           | `overview-resources-charcoal.png` | Gray containers with a yellow database emblem                                  |
| Servers             | `overview-servers-charcoal.png`   | Gray cargo ship and containers with yellow trim and windows                    |
| No active incidents | `overview-healthy-matched.png`    | Happy yellow Scout beside gray containers                                      |
| Active incidents    | `overview-smoking-matched.png`    | Worried yellow Scout beside gray containers and a red container emitting smoke |

`dashboard-overview.tsx` uses the three inventory illustrations.
`overview-operations.tsx` selects the incident illustration from the active incident
count. The original Scout-only variants, `mascot-all-ok.png` and
`mascot-worried.png`, are retained but are not used by the overview.
`mascot.webp` is the original character reference.

## Visual direction

Use simple, soft 3D forms with rounded corners, broad container grooves, smooth
surfaces, and restrained lighting. Avoid small hardware, realistic metal or fur
textures, and busy details. Apps and Resources share a container composition.

Inventory objects use darker neutral charcoal gray, clearly lighter than black,
with no blue or cyan cast. The latest color prompt requested main lit faces around
`#454545` to `#505050`; these are generation targets, not exact pixel values.
Docker and database emblems and ship accents remain yellow. The incident assets
retain their accepted gray containers and yellow Scout; red cargo and smoke denote
an active incident.

## Composition and rendering

The illustrations are composed for the bottom-right corner of a widget. Objects
continue beyond the bottom and right canvas boundaries so they meet the card edges
without a transparent gutter. Transparent space belongs above and to the left of
the subject. Scout's face remains visible.

The current PNGs are copied from ImageGen at their original resolution, without
local recoloring, resizing, or alpha-margin trimming. The UI anchors them with
`bottom: 0` and `right: 0`, without negative offsets, and displays them at 112 by
112 CSS pixels. Next Image uses width and height values of 512 to avoid undersized
optimized images on high-density screens.

## Generation notes

All assets were generated or edited with the built-in image tool. The shared
composition prompt requested a minimal soft 3D dashboard illustration on an actual
transparent PNG background, with objects visibly cut off at the bottom and right
canvas edges, simple gray containers, yellow accents, and no fine detail.

The incident variants were refined to use rectangular shipping containers with
broad vertical grooves. The active variant shows worried Scout beside a red
container with soft gray smoke puffs. The healthy variant replaces red cargo with
gray, removes smoke, and gives Scout a happy expression. Their accepted colors
served as the reference for removing the blue cast from the inventory images.

The final inventory edit prompt was:

> Make all gray objects darker neutral charcoal gray, around #454545 to #505050
> on the main lit faces, distinctly gray not near black. Absolutely no blue tint.
> Preserve the yellow parts, composition and simple smooth shapes. Smooth uniform
> plastic, no mottled texture. Remove the entire checkerboard background: output
> actual transparent PNG alpha outside objects, not a drawn checkerboard. Objects
> remain fully opaque and cut off at bottom and right edges.

Some generated outputs contained a drawn checkerboard despite the transparency
request. The final background-removal pass used:

> Remove the background from this image. Output a PNG with transparency. Keep all
> objects unchanged.

The shipped files were checked for alpha channels and visually inspected in the
local overview. Background removal was performed by ImageGen, not a local filter.
Earlier intermediate variants and their superseded prompts are available in Git
history; they are not the current asset specification.
