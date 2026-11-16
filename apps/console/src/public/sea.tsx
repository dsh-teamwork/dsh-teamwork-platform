/**
 * The home page's hero illustration: one black wave line across the full
 * width, and behind it, faint, the brand's fluke (docs/design.md, "The mark")
 * where it has always been, sounding into the water. It is an illustration,
 * not the logo: drawn from tokens so it follows the theme, and never exported.
 * The fluke's path is the mark's, in its 64-unit box.
 *
 * Below the line the sea is the page's own ground, painted over the fluke's
 * stalk so it goes under the surface instead of ending at a line. The line is
 * one period (160 units) of quadratic segments, drawn a period past both
 * edges, so shifting it left by one period (`sea-drift` in globals.css) loops
 * without a seam.
 */
const FLUKE = 'M32 24.6C29.5 21.8 25 20.6 20 21C16.5 21.3 13.8 20.6 11.8 19.2C13.2 23.6 17 27.6 22.5 29.6C26.5 31 29.6 31.8 30.4 34L28.5 44.5H35.5L33.6 34C34.4 31.8 37.5 31 41.5 29.6C47 27.6 50.8 23.6 52.2 19.2C50.2 20.6 47.5 21.3 44 21C39 20.6 34.5 21.8 32 24.6Z';
const SURFACE = 'M-160 300Q-120 282 -80 300T0 300T80 300T160 300T240 300T320 300T400 300T480 300T560 300T640 300T720 300T800 300T880 300T960 300T1040 300T1120 300T1200 300T1280 300T1360 300T1440 300T1520 300T1600 300T1680 300T1760 300';

export function Sea() {
  return (
    <svg
      viewBox="0 0 1600 460"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className="block h-[clamp(220px,30vw,440px)] w-full"
    >
      <path className="fill-foreground opacity-[0.07]" d={FLUKE} transform="translate(960 310) rotate(-15) scale(8.6) translate(-32 -44)" />
      <g className="sea-drift">
        <path className="fill-background" d={`${SURFACE}V460H-160Z`} />
        <path className="fill-none stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" d={SURFACE} />
      </g>
    </svg>
  );
}
