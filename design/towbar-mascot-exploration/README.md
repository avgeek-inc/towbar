# Towbar trailer mascot exploration

These transparent PNGs explore one character across common empty and error states. The Towbar container-trailer logo is the visual reference; the mascot is an illustration, not a replacement for the logo. `master.png` establishes the body, face, arms, materials, and camera angle. Each state is an edit of that master.

| State                 | Visual cue                                         | File                        |
| --------------------- | -------------------------------------------------- | --------------------------- |
| 404 / not found       | Searching with a route map that stops              | `not-found-404.png`         |
| 500 / server error    | Concerned, holding a wrench under a warning beacon | `server-error-500.png`      |
| Missing configuration | Patiently holding an unplugged connector           | `missing-configuration.png` |
| Misconfigured         | Trying to join incompatible connectors             | `misconfigured.png`         |
| 400 / invalid request | Examining a bent parcel slip                       | `bad-request-400.png`       |

## Prompt set

The built-in image generator was used with `docs/assets/towbar-logo.png` as the master edit reference. The master prompt asked for a friendly three-quarter-view soft 3D character retaining the bright yellow corrugated container, two trailer wheels, charcoal chassis, and short tow hitch, with a simple face on the broad yellow side and two rounded charcoal arms. It required an actual transparent alpha background, a complete centered silhouette, no text, and readability at 120px.

Each state used `master.png` as its edit reference and repeated the invariants: preserve the body, face location, wheels, chassis, hitch, material, camera angle, and complete silhouette. Only expression, arm pose, and one contextual prop changed:

- **404:** Mildly puzzled, one hand shading its eyes, the other holding a blank route map with a dotted path that stops.
- **500:** Concerned but calm, holding a charcoal wrench, with one small red warning beacon on top. No smoke or fire.
- **Missing configuration:** Patient and expectant, holding one unplugged charcoal connector with a gold contact.
- **Misconfigured:** Gently concerned, holding incompatible round and square cable ends close together.
- **400:** Thoughtful and mildly confused, showing a blank bent parcel slip with one crooked line.

All variants asked for one centered character with transparent margins, no floor or backdrop, no letters or numbers, no watermark, and no extra characters. These are concepts for review; state copy and recovery actions must still explain the problem. The optimized `missing-configuration.webp` in `apps/towbar-web-app/public/mascots/` is the first in-product preview.
