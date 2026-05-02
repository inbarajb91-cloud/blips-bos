# BLIPS Materials Playbook · Tactile Vocabulary for FURNACE

> Status: **v0 scaffold — refine via Settings → Knowledge.** First-pass framing drafted by Claude on May 3 from premium-streetwear material practice + brand-identity-v3 sources. Inba should rewrite/refine each section in voice; the structure is what FURNACE pulls via `recall(container='knowledge')` when shaping `tactileIntent` for a brief.

---

## Why this doc exists

FURNACE has a hard rule: **every brief must include a `tactileIntent` section that describes what the garment should FEEL like and communicate physically.** Premium positioning means BLIPS designs are never "white tee with print" — even subtle moves (textured fabric, brushed back fleece, garment dye finish, considered weight) are part of the design intent.

For ORC to write good tactile intent without hallucinating, it needs **grounded vocabulary**. Three tiers supply this:

- **Tier 1** — short anchor in FURNACE's system prompt (~250 tokens of curated material vocabulary, always loaded)
- **Tier 2 — THIS DOC** — the deeper material vocabulary + BLIPS-specific direction. Recalled by FURNACE per brief.
- **Tier 3** — past briefs in the events container — every approved `tactileIntent` writes to memory; recall surfaces patterns over time.

This doc is Tier 2. Founder edits over time; ORC pulls fresh on every brief generation.

---

## Material categories

### Cottons (the BLIPS workhorse class)

| Material | Tactile character | Visual register | Best for |
|---|---|---|---|
| **Heavyweight cotton (300-400 GSM)** | Substantial, structured, weighted hand. Takes ink with weight (no spread). | Considered, premium, statement | Raw industrial register (S01), back-panel pieces, hero drops |
| **Mid-weight cotton (220-280 GSM)** | Versatile workhorse. Balanced drape. | Neutral, flexible | Baseline tees, supporting pieces, color-anchored drops |
| **Combed cotton** | Smoother hand than open-end. Less surface fuzz. | Refined, dressier | Premium baseline, lighter colorways where surface matters |
| **Pima / Supima** | Long-staple, soft hand, premium drape. | Luxury, refined | Capsule pieces, special editions |
| **Slub jersey** | Irregular yarn texture (knot-and-thin variation). Casual but considered. | Worn-in, artisanal | "This is not a basic tee" subtle moves, S02 cold cosmic register |
| **Brushed cotton** | Soft fuzzy interior, warmth. | Quiet, lived-in | Layering pieces, RCD comfort register |
| **Garment-dyed cotton** | Color depth + slight character from shrinkage + softer hand. | Considered colorways, premium | Color-led drops, RCL warm-tone pieces |
| **Heavyweight raw cotton (untreated)** | Crisp, structural. Will soften over wear. | Industrial, structural | Raw industrial S01, structural front-panel pieces |

### Heavier wovens

| Material | Tactile character | Visual register | Best for |
|---|---|---|---|
| **Canvas (heavy cotton weave, 12-16 oz)** | Durable, crisp, takes prints with substantial weight. | Workwear, heritage | Limited drops, capsule outerwear, heritage pieces |
| **Twill (cotton diagonal weave)** | Diagonal weave, strong, drapes well. | Considered casual | Chinos, military-influenced shirts, layering pieces |
| **Oxford weave** | Basket weave, dressy-casual. | Dressier, structured | Structured shirts, premium long-sleeves |
| **Denim (twill weave with indigo)** | Distinctive fade character. Heavyweight = structural. | Heritage, considered | Capsule denim pieces, jacket linings |

### Textured / specialty

| Material | Tactile character | Visual register | Best for |
|---|---|---|---|
| **Corduroy 8-wale (fat wales)** | Pronounced ribbed pile. Strong texture. | Vintage, statement | Heritage capsule pieces, statement outerwear |
| **Corduroy 14-wale (standard)** | Balanced ribbed pile. | Considered casual | Versatile capsule, mid-weight pieces |
| **Corduroy 21-wale (fine pinwale)** | Subtle ribbed texture. | Refined, considered | Premium capsule, dressier pieces |
| **Velvet / velour** | Pile fabric, luxury register. | Luxury, statement | Special editions only — handle with intent |
| **Boucle** | Looped texture, artisanal. | Craft, artisanal | Limited capsule pieces with hand-feel intent |
| **Waffle knit** | Thermal pattern, visible structure. | Technical, considered | Layering pieces, henley-style pieces |
| **Pointelle** | Small holes pattern, delicate. | Refined, feminine-coded | Delicate pieces (use sparingly) |
| **Jacquard** | Woven pattern, considered, expensive feel. | Premium, considered | Special editions with pattern intent |

### Knits + fleeces

| Material | Tactile character | Visual register | Best for |
|---|---|---|---|
| **French terry** | Looped interior, smooth exterior. Mid-weight. | Casual considered | Casual layering, transitional pieces |
| **Loopback** | Heavier French terry, more structure. | Substantial casual | Casual pieces with weight |
| **Sweatshirt fleece (brushed back)** | Quiet warmth, soft interior, structured exterior. | Classic considered | Hoodies, crewnecks, S03 warm reckoning |
| **Heavyweight fleece (400+ GSM)** | Substantial warmth, heavy hand. | Substantial, premium | Hero hoodies, heavyweight crewnecks |

### Performance / blends (USE WITH INTENT — not for default)

| Material | Tactile character | Visual register | When to use |
|---|---|---|---|
| **Cotton/linen blend** | Textured, breathable, considered hand. | Warm-weather considered | Summer pieces with character |
| **Cotton/Tencel blend** | Drapey, soft, slightly lustrous. | Refined, draped | Premium drape pieces |
| **Recycled cotton** | Slight texture, sustainability story. | Considered, conscious | When the brand story warrants it |
| **Polartec / technical fleece** | Performance hand, lightweight warmth. | Technical, sport | Outdoor capsule pieces (rare for BLIPS) |
| **Mesh / micro-mesh** | Sport hand, see-through. | Sport register | Sport-adjacent pieces only |
| **Nylon / ripstop** | Crisp, technical, weather-resistant. | Outerwear technical | Outerwear pieces (rare) |

---

## Treatments + finishes

### Color treatments

- **Garment dye** — color depth + soft hand + slight shrinkage character. Premium positioning. Can be uneven (intentional variation reads premium).
- **Pigment dye** — vintage character, naturally faded look from day one.
- **Acid wash** — high-contrast vintage look. Use sparingly; reads strongly.
- **Stone wash** — softer hand, slightly faded color, classic denim treatment.
- **Enzyme wash** — softens cellulose fibers without changing color much.
- **Reactive dye** — color saturation + colorfast. Standard for solid colorways.

### Surface treatments

- **Brushed surface** — softens, warmer, more lived-in feel.
- **Sanded** — slightly fuzzy surface, peach-skin hand.
- **Mercerized** — smoother, more lustrous, takes color brighter.
- **Bio-polished** — smoother, less pilling, premium hand.
- **Garment wash** — softens overall, slight color fade.

### Print-affecting treatments

- **Sizing/starch** — crisp hand for screen printing precision; washes out.
- **Discharge-ready treatment** — required for discharge ink technique.

---

## BLIPS-specific direction

### What fits BLIPS

- **Heavyweight base fabrics (300-400 GSM)** — anchor of the line. Reads "considered, expensive" from the first touch.
- **Brushed back fleeces** — hoodies and crewneck classics with quiet warmth.
- **Corduroy** — texture-as-design moves for limited drops.
- **Garment-dyed treatments** — color depth that reads premium and intentional.
- **Slub or textured jersey** — when "this is not a basic tee" needs to be true at first touch.
- **Cotton/linen blends** — warmer-weather pieces with character.
- **Considered hardware** — woven labels, wash labels, hangtags as art objects.
- **Inside details** — design moves that don't show on the outside but reward the wearer (printed inside necks, considered seam tape, statement labels).

### What does NOT fit BLIPS

- **Thin cottons (<180 GSM)** — reads cheap regardless of design.
- **Polyester blends without intent** — performance/sport register, wrong for editorial brand.
- **Generic 180 GSM ringspun jersey** — the "white tee with print" default failure mode.
- **Synthetic-feeling treatments** — unless explicitly part of the design (technical capsule).
- **Trend-following materials** — chase materials are anti-brand. Use materials that ladder to permanence.
- **Cheap polo blends, overly stretchy modals, athleisure rayons** — wrong register.

### Decade × material affinities

These are starting points, not rules — every signal can break the pattern with intent.

**RCK (28-38) — career inflection, ambition vs meaning, urban professional**
- Leans heavy + structural — the decade is at first weight. Heavyweight cotton, garment-dyed indigo or char, raw cotton with intentional drape.
- Technical considered moves work — French terry crewneck with quiet treatment, mid-weight cotton with brushed surface.
- Avoid: anything too soft / too feminine-coded / too vintage. The decade isn't nostalgic yet.

**RCL (38-48) — recalibration, parenthood-pivot, success-fatigue, peak career + no energy**
- Leans considered + textured — the decade is at first time-luxury. Slub jersey, corduroy for capsule pieces, brushed back fleece for the quiet-warmth register.
- Garment dyes work strongly here — color with character matches the decade's "I've earned considered things."
- Avoid: anything too aggressive (S01 on RCL reads loud), anything too youth-coded.

**RCD (48-58) — reckoned, mortality-aware, what-was-it-for, ambition decay**
- Leans worn-in + brushed + heritage — the decade is at first softness. Brushed cotton, washed slub, vintage-treated cotton, French terry that's already lived a life.
- Heritage materials work — heavyweight cotton in deep earth tones, considered corduroy, textured wovens with weight.
- Avoid: anything that screams new / current / trend-chasing. The decade is past that.

---

## Tactile language ORC should use

When writing `tactileIntent`, prefer these words over generic adjectives:

### About the fabric character
- **Hand** — how the fabric feels when touched (e.g. "soft hand" / "crisp hand" / "structured hand" / "drapey hand")
- **Drape** — how it falls when held up (e.g. "fluid drape" / "structured drape" / "weighted drape")
- **Ground** — the base fabric character (e.g. "heavyweight cotton ground" / "slub jersey ground")
- **Pile** — for textured fabrics (e.g. "soft pile corduroy" / "dense pile velvet")
- **Wale** — corduroy ridge spacing
- **GSM** — grams per square meter (weight measurement) — use ONLY in tactileIntent context, NEVER as a hard product spec (that's ENGINE Step 1)
- **Loop** — French terry interior structure
- **Stitch density** — knitwear gauge

### About what the garment communicates
- **Communicates considered weight** — not just heavy, but heavy WITH PURPOSE
- **Reads quiet** — restraint that's noticed without being demanded
- **Reads worn-in** — has character before it's been worn
- **Reads structural** — hold its shape
- **Reads soft (intentionally)** — not flabby, but yielding
- **Reads premium without shouting** — the BLIPS register

### About how it should age
- **Soften with wear** — get better over time
- **Develop character** — fades, surfaces wear, intentional patina
- **Hold structure** — for pieces that should look the same in year 5
- **Maintain color** — when the colorway is the point
- **Go natural** — when the design intends to age into something else

---

## Anti-patterns ORC should never write

- "Soft cotton" — too generic. Be specific.
- "Comfortable to wear" — every shirt is. Doesn't say anything.
- "Premium fabric" — used so much it means nothing. SHOW premium via specific material + treatment.
- "High-quality construction" — that's ENGINE's tech pack territory, not FURNACE's tactileIntent.
- "Made from the finest cotton" — marketing copy, not design intent.
- "Suitable for all seasons" — not a design call.
- "Versatile and stylish" — say nothing.

When `tactileIntent` reads like Amazon product copy, FURNACE has failed.

---

## How FURNACE uses this doc

At brief-generation time, FURNACE's prompt includes:

1. The Tier 1 anchor (short ~250-token vocabulary baked into the system prompt)
2. THIS DOC (Tier 2, recalled via `recall(query="materials direction for ${decade}-coded ${moodAndTone}", container='knowledge')`)
3. Past briefs (Tier 3, recall events container for similar past `tactileIntent` values)

The prompt also instructs FURNACE: "Your `tactileIntent` must propose a SPECIFIC material direction (e.g., 'heavyweight cotton 320 GSM, garment-dyed deep charcoal, brushed-back interior') with a brief tactile-character note. Generic adjectives ('soft', 'comfortable', 'premium') are failures. ENGINE will translate your direction into precise material spec; your job is to capture INTENT clearly enough that ENGINE has a starting point."

---

## Open questions for the founder

- Are there material categories on this list BLIPS will never use? (e.g., velvet may be too far from brand register)
- Are there material categories BLIPS uses that this list misses?
- Is the decade × material affinity table directionally right or does it need rethinking?
- Should this doc include weight/GSM specifics or stay at the directional level?
- Do we want a separate VENDORS.md or PRINT.md doc, or do those concerns stay inside ENGINE Step 1?

---

*This playbook is the source of truth FURNACE pulls when shaping the tactileIntent section of every brief. When you update it, save through Settings → Knowledge so the supermemory copy refreshes.*
