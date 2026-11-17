# 0035. The fluke rises from a layered sea

> **Status:** Accepted · **Date:** 2026-11-16

## Context

The first mark drew the sea as one thin paper wave across an indigo plate, with
a gap on each side of the fluke's stalk and the stalk cut off below the line.
At icon sizes the gaps vanish and the cut stays, so the fluke reads as a tail
severed from its whale: an image a reader can fairly object to. The landing
page's hero (`apps/console/src/public/sea.tsx`) already shows the reading that
works, a fluke going down into a full sea with a wavy surface.

## Decision

The mark is a fluke rising from a sea that fills the lower part of the plate.
The fluke keeps its old size and the sea surface its old height, so the
composition does not move. Fluke, sea and sky are each a different colour: an
indigo sky, a paper fluke, a deep sea that covers the stalk, a light surface
band along its wavy top, and two darker swell bands inside it. The bands give
the sea depth in layers, which is the brand's idea that work settles into what
the team keeps. `docs/design.md`, "The mark", has the geometry.

### Turned down

Four versions were drawn and compared at 96 to 16 px on light and dark grounds.
A first round painted the fluke and the sea in one colour; they merged into one
shape, so every version below separates them.

- **A — light sea.** Indigo sky, paper fluke, a plain light-blue sea. The
  simplest and clearest at 16 px, but flat: nothing says depth.
- **B — the hero inverted.** Paper sky, indigo fluke, a bright blue sea with
  two paper foam lines. Closest to the landing page, but the plate turns paper,
  so on a white page its top edge disappears and the icon loses its outline.
- **D — light sea with foam.** A with two indigo foam lines and a longer,
  calmer wave. More sea than A, but at 32 px and below the lines run together
  and would need a separate small-size drawing, which the mark does not have.

## Consequences

- The mark uses five colours instead of two. The three sea tones are indigo's
  own hue and belong to the mark only; no page uses them, and the brand palette
  for everything else stays indigo and paper.
- The mark is several filled paths in a fixed painting order instead of one
  path. The exports (`scripts/generate-icons.mjs`) read only the plate, so they
  needed no change.
- At 16 px the swell bands blur into the deep sea; the picture still reads as a
  fluke over water, which is what it has to do at that size.
- The mark and the hero now differ in colour: the hero stays drawn from the
  ocean tokens on a paper sky. They share the fluke and the wave.
