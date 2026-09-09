# Incident mascot assets

## Unified yellow accents and gray cargo

Current replacements: `overview-apps-v2.png`, `overview-servers-v2.png`, `overview-healthy-v2.png`, `overview-smoking-v2.png`. Edited with the built-in image tool and cropped to visible alpha bounds as above. The resource illustration remains `overview-resources-trimmed.png`.

apps prompt: Change only the blue Docker symbol to warm golden yellow. Keep the graphite gray containers unchanged. Preserve the soft matte style and transparent PNG background. Keep every object fully inside the frame.

servers prompt: Simplify the ship and its cargo containers into a minimal smooth 3D toy. Remove the mast, tiny latches, door rods, corner holes, smokestack stripes and excess corrugations. Keep three simple rounded gray cargo boxes with just a few broad grooves, a simple cabin with dark windows, gray hull and yellow border trim. Preserve recognizable cargo ship silhouette and current angle. Preserve the soft matte style and transparent PNG background. Keep every object fully inside the frame.

healthy prompt: Change all green shipping containers to uniform medium graphite gray. Keep Scout yellow with the exact happy pose and soft plush style unchanged. Preserve the soft matte style and transparent PNG background. Keep every object fully inside the frame.

smoking prompt: Change only the two green shipping containers to uniform medium graphite gray. Keep the red container red with its smoke, and keep Scout yellow in the same worried pose and soft plush style. Preserve the soft matte style and transparent PNG background. Keep every object fully inside the frame.

Each edit then used this background extraction prompt: Remove the background from this image. Output a PNG with transparency. Keep all objects unchanged.

## Darker gray and trimmed assets

Current inventory assets: `overview-apps-trimmed.png`, `overview-resources-trimmed.png`, and `overview-servers-trimmed.png`. Current incident assets: `mascot-soft-healthy-trimmed.png` and `mascot-soft-smoking-trimmed.png`.

Color edits used the built-in image tool. After generation, all five assets were cropped to their visible alpha bounds using Sharp, as requested. The crop ignores alpha values at or below 16/255 when locating the bounds to avoid almost invisible generated speckles; retained pixels keep their original alpha.

apps prompt: Darken both shipping containers to a clear medium graphite gray, approximately #747b84 base paint, with soft shading. Keep the blue Docker symbol unchanged. Preserve composition, smooth matte toy style and transparent PNG background.

resources prompt: Darken both shipping containers to a clear medium graphite gray, approximately #747b84 base paint, with soft shading. Keep the yellow database symbol unchanged. Preserve composition, smooth matte toy style and transparent PNG background.

servers prompt: Change the boat hull, cabin walls, smokestack and mast to neutral medium gray. Keep yellow ONLY as narrow border trim around the deck rim, cabin roof edge and bottom hull edge. Cargo containers stay gray. No large yellow filled surfaces. Preserve soft matte 3D style, composition and transparent PNG background.

Apps and boat background extraction prompt: Remove the background from this image. Output a PNG with transparency. Keep all objects unchanged.

## Yellow inventory accents

Current resources and server assets are `overview-resources-yellow.png` and `overview-servers-yellow.png`, edited using the built-in image tool from their preceding versions. Both have transparent alpha.

Database prompt: Change only the blue database cylinder symbol to warm golden yellow. Preserve gray containers, smooth soft toy style, composition and transparent PNG background.

Boat prompt: Recolor the boat itself in soft warm yellow shades: golden yellow trim and pale buttery yellow hull and cabin. Keep cargo containers gray, windows dark, and preserve the smooth soft toy style and exact composition. Transparent PNG background.

## Inventory widget illustrations

Generated using the built-in image tool with `mascot-soft-healthy.png` as the style reference. All three final PNGs have transparent alpha.

### overview-apps.png

Prompt: Create a transparent PNG dashboard illustration. Two small light gray shipping containers stacked slightly offset, with a clear blue Docker whale-and-containers symbol centered on the front container. Soft simplified 3D designer toy aesthetic matching the containers in the reference. Smooth matte surfaces, rounded corners, broad simplified corrugations, gentle diffuse lighting, no realistic metal texture, no tiny details. Compact centered landscape composition, all objects inside frame with margin, readable at 100px wide. Only the described objects; no Scout bird, no text, no floor, no backdrop. Genuine transparent alpha background.

### overview-resources.png

Prompt: Create a transparent PNG dashboard illustration. Two small light gray shipping containers stacked slightly offset, with a clear blue database cylinder symbol centered on the front container. Soft simplified 3D designer toy aesthetic matching the containers in the reference. Smooth matte surfaces, rounded corners, broad simplified corrugations, gentle diffuse lighting, no realistic metal texture, no tiny details. Compact centered landscape composition, all objects inside frame with margin, readable at 100px wide. Only the described objects; no Scout bird, no text, no floor, no backdrop. Genuine transparent alpha background.

### overview-servers.png

Prompt: Create a transparent PNG dashboard illustration. One small friendly cargo ship in three quarter view, neutral light gray hull, blue trim, carrying a few light gray shipping containers. No water or scenery. Soft simplified 3D designer toy aesthetic matching the containers in the reference. Smooth matte surfaces, rounded corners, broad simplified corrugations, gentle diffuse lighting, no realistic metal texture, no tiny details. Compact centered landscape composition, all objects inside frame with margin, readable at 100px wide. Only the described objects; no Scout bird, no text, no floor, no backdrop. Genuine transparent alpha background.

Ship background extraction: Remove the background from this image. Output a PNG with transparency. Keep the ship and its containers.

## Soft texture revision

Current assets: `mascot-soft-healthy.png` and `mascot-soft-smoking.png`. Generated using the built-in image tool from the preceding healthy/smoking container images. Both have verified transparent alpha. Prior prompts below document the asset history.

Healthy prompt: Restyle this exact illustration into a soft, simplified 3D designer toy render. Scout should have smooth velvety plush surfaces with only a subtle hint of down, no individually visible strands, scratchy fur, grain or realistic pores. Containers should have softly rounded corners, simplified broad corrugations and matte painted toy surfaces, no sharp metallic detail. Soft diffuse lighting, gentle shading and restrained highlights. Preserve Scout's identity, yellow color, expression and pose, composition, uniform emerald green containers. Keep crisp readable silhouettes, do not simply blur the image. Output a transparent PNG cutout.

Smoking prompt: Restyle this exact illustration into a soft, simplified 3D designer toy render. Scout should have smooth velvety plush surfaces with only a subtle hint of down, no individually visible strands, scratchy fur, grain or realistic pores. Containers should have softly rounded corners, simplified broad corrugations and matte painted toy surfaces, no sharp metallic detail. Soft diffuse lighting, gentle shading and restrained highlights. Preserve Scout's identity, yellow color, expression and pose, composition, uniform emerald green containers, red top container and smoke plume. Make the smoke soft rounded stylized puffs. Keep crisp readable silhouettes, do not simply blur the image. Output a transparent PNG cutout.

## Uniform green and smoke revision

Generated with the built-in image tool. Both final assets have verified transparent alpha. These replace the earlier container variants; original Scout-only assets remain.

### mascot-containers-healthy.png

Edited the earlier all-clear container asset with: Edit only the container paint colors: all three containers must have the same uniform medium emerald green paint, matching the front left container. Keep natural lighting and shading, but no lime green and no different green hues. Preserve Scout, pose, layout and transparent PNG background.

Final background extraction prompt: Remove the background from this image. Output a PNG with transparency. Keep the bird and all three containers.

### mascot-containers-smoking.png

Edited the earlier worried container asset with: Edit the two green containers to the same uniform medium emerald green paint, no lime green. Add a clearly visible soft gray plume of smoke rising from the top of the red container, in the same 3D illustration style. Smoke must originate only from the red container and stay clear of Scout's face. Keep the red container red, preserve Scout's worried pose and composition. Transparent PNG background, including around the smoke.

## Container variants

Both container variants are transparent PNG assets generated with the built-in image tool. The original mascot assets are retained.

### mascot-containers-all-ok.png

Reference: `mascot-all-ok.png`.

Prompt: Edit this Scout mascot asset. Preserve the exact yellow fluffy chick character, happy reassuring waving pose, glossy black eyes, ivory beak, dark feet, and soft 3D toy rendering. Add three small corrugated shipping containers beside and slightly behind Scout, in harmonious green shades, all healthy. Containers should clearly resemble miniature shipping containers with ribbed sides, matching the same polished 3D aesthetic. Scout remains the focal point and fully visible. Compact landscape composition, character and containers together readable at 180px wide. Full objects inside frame. Genuine transparent alpha background, no floor, no lettering, no logos, no extra characters. This is the all-clear infrastructure state.

### mascot-containers-worried.png

Reference: `mascot-containers-all-ok.png`.

Prompt: Edit this image: change the chick's expression to worried with its wings near its cheeks. Recolor the top green shipping container red, keeping the other containers green. Preserve everything else exactly, including the background.

The generated edit was then passed through the image tool with this prompt to produce the final transparent asset: Remove the background from this image. Output a PNG with transparency. Keep the bird and all three containers.

## Original variants

Generated with the built-in image generation tool using `mascot.webp` as the character reference. Both PNG files preserve transparent alpha. The existing mascot is unchanged.

### mascot-all-ok.png

Prompt: Create one transparent PNG UI mascot asset based on the reference Scout bird. Preserve exactly this yellow fluffy chick character, round body, glossy black eyes, little ivory beak, three crown feathers, dark feet, soft polished 3D toy rendering. Full body, centered square composition with a small even margin. Expression and pose: visibly calm, happy and reassuring, signalling all OK, one wing lifted in a gentle reassuring wave, relaxed stance, eyes warm and cheerful. Keep recognizable bird anatomy, no human hands. No extra objects, no lettering, no badge, no background, no ground plane. Genuine transparent alpha around the character, no checkerboard. Designed to be legible at 140px in a dashboard on both dark and light backgrounds.

### mascot-worried.png

Prompt: Create one transparent PNG UI mascot asset based on the reference Scout bird. Preserve exactly this yellow fluffy chick character, round body, glossy black eyes, little ivory beak, three crown feathers, dark feet, soft polished 3D toy rendering. Full body, centered square composition with a small even margin. Expression and pose: worried and tense, clearly concerned about an incident, slightly hunched shoulders, wings held near cheeks, eyes looking anxiously forward with worried eyebrows, small tense open beak. Gentle worried expression, not horror or crying. Keep recognizable bird anatomy, no human hands. No extra objects, no lettering, no badge, no background, no ground plane. Genuine transparent alpha around the character, no checkerboard. Designed to be legible at 140px in a dashboard on both dark and light backgrounds.

# Bottom-right illustrations

Current assets: `overview-apps-corner.png`, `overview-resources-corner.png`,
`overview-servers-corner.png`, `overview-healthy-corner.png`, and
`overview-smoking-corner.png`.

Generated using built-in image generation in edit mode. Shared direction: front-facing
soft matte 3D illustrations, graphite containers, golden yellow accents, three broad
grooves, no fittings or small hardware. Apps and Resources share the same container
composition. The ship faces bow-first toward the viewer. Scout retains happy and
worried states, with red cargo and smoke only for active incidents.

Prompt details:

- apps: Two stacked graphite containers, rear container offset slightly right, front container faces viewer squarely with a golden yellow Docker whale emblem.
  Simplification: Edit this illustration: simplify both containers to smooth rounded charcoal gray boxes with THREE broad vertical grooves only. Remove all holes, bolts, corner fittings and fine detail. Change yellow database emblem to yellow Docker whale emblem. Keep same frontal view and stacked composition. No bird. Soft matte clay with no texture. Remove background completely; actual transparent PNG, not checkerboard.
- resources: Two stacked graphite containers, rear container offset slightly right, front container faces viewer squarely with a golden yellow database cylinder emblem. Same container geometry as apps reference.
  Simplification: Replace only the Docker whale emblem with a yellow database cylinder emblem. Keep the exact same containers, geometry, colors, framing and style. Remove background, output actual transparent PNG.
- servers: A simple small cargo ship seen BOW-ON, bow pointing straight out toward viewer from bottom-right corner. Gray hull and cabin with yellow edge trim only, two graphite containers above deck facing viewer. Very simple rounded forms, no mast, no rigging, no tiny details.
  Simplification: Simplify containers to smooth charcoal rounded boxes with three broad recessed grooves only, remove corner fittings and all small details. Keep composition, colors and subject identity unchanged. Smooth matte clay texture. Remove background, output actual transparent PNG.
- healthy: Scout yellow bird from second reference looking happy and waving, beside two graphite containers. Face toward viewer, very soft smooth fur, not photorealistic. Containers face forward, all gray, no green, no smoke.
  Simplification: Simplify containers to smooth charcoal rounded boxes with three broad recessed grooves only, remove corner fittings and all small details. Keep composition, colors and subject identity unchanged. Smooth matte clay texture. Remove background, output actual transparent PNG.
- smoking: Scout yellow bird from second reference looking worried with hands on cheeks, beside two graphite containers and one red container emitting three soft gray smoke puffs. Face toward viewer, very soft smooth fur, not photorealistic. Containers face forward, no green.
  Simplification: Simplify containers to smooth charcoal rounded boxes with three broad recessed grooves only, remove corner fittings and all small details. Keep composition, colors and subject identity unchanged. Smooth matte clay texture. Remove background, output actual transparent PNG.

Final background-extraction prompt: Remove the background from this image. Output a
PNG with transparency. Keep all objects unchanged.

Transparent margins were trimmed to visible alpha bounds after generation. The UI
anchors each asset to the bottom-right edge with a small clipped bleed.

# Edge-composed illustrations

Current files: `overview-{apps,resources,healthy,smoking}-edge.png` and `overview-servers-edge-v2.png`.

Generated with the built-in image tool. The canvas composition itself carries objects
through the bottom and right edges. Files are copied unchanged; no post-generation
cropping. UI uses bottom: 0 and right: 0, without negative offsets.

Shared generation prompt:

Create a minimal soft 3D dashboard corner illustration. Actual transparent PNG background with alpha, NOT a checkerboard drawing. IMPORTANT placement problem: this image is rendered flush against a card's bottom and right edges, so a fully visible rounded object leaves ugly transparent gaps. Solve IN THE IMAGE COMPOSITION: objects extend well BEYOND the right and bottom canvas boundaries and are visibly sliced by the straight canvas edges. No transparent gutter along the lower right edge. Do not include full silhouettes or rounded bottom-right object corners. Transparent area only above and to the left of the subject. Square canvas.
Unified design: extremely simple matte clay, flat broad surfaces, uniform medium charcoal gray (#60656c), warm yellow (#f6c634), just two shallow grooves on containers, no frames, no rims, no bolts, no tiny details, no outlines, no photorealism, no fur texture, no glossy highlights. Straight-on view. Soft subtle shading. Large uncomplicated shapes, readable at 100px.

Subject prompts:

- apps: Two overlapping gray containers. Yellow simple Docker whale symbol on the front one. Front container continues off BOTH bottom and right canvas edges. No mascot.
- servers: Bow of a small gray cargo ship with a single yellow trim stripe, one simple cabin with two windows, two gray containers. Bow and right side of ship continue off bottom and right canvas edges. No mast or smokestack.
- smoking: Yellow Scout chick, worried expression, simple black eyes, hands on cheeks. Two gray containers and one red container with two simple gray smoke puffs. The lower containers and Scout body continue OFF the bottom and right canvas edges. Face fully visible. Same minimalist clay shapes as containers, no realistic fur, no feet visible.

Refinements:

- resources-prompt: Change ONLY yellow Docker whale symbol to a simple yellow database cylinder emblem. Preserve exact gray containers, colors, soft matte style, composition and edge cropping. Actual transparent PNG background directly.
- smoking-prompt: Replace the three cylindrical barrels in image 1 with rectangular shipping containers matching image 2: broad smooth gray rounded boxes with two shallow VERTICAL grooves. Keep top container muted red and smoking. Preserve Scout, colors and composition from image 1. Objects continue off bottom and right canvas edges. No outlines, no detail, soft matte clay. Actual transparent PNG background directly.
- servers-finalprompt: Simplify only the ship's cargo containers to match image 2 exactly: TWO broad shallow vertical grooves per container, same medium charcoal gray, broad smooth matte surfaces, no raised edges or frames. Keep ship composition and yellow stripe, no new details. Objects must remain cut off at right and bottom canvas edges. Actual transparent background PNG directly, preserve alpha.
- healthy-finalprompt: Keep exact composition, shapes and matte clay style. Change red container to matching gray, remove smoke, make Scout smile happily and lower hands. Keep bottom and right objects cropped by canvas boundaries. Output actual transparent PNG background with alpha, no checkerboard.

Transparency was requested directly in every prompt. Inventory outputs retained alpha;
Scout edits required a subsequent ImageGen background removal request. All final PNGs
were checked for an alpha channel. No local background removal was used.
