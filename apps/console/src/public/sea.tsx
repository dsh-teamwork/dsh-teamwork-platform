/**
 * The home page's hero illustration: the brand's fluke (docs/design.md, "The
 * mark") at hero scale, sounding into a sea that runs the full width and
 * becomes the ocean the sections below sit in. It is an illustration, not the
 * logo: drawn from tokens so the fluke is indigo on paper and paper on a night
 * sky, and never exported. The fluke's path is the mark's, in its 64-unit box.
 *
 * Each wave is one period (160 units) of quadratic segments, drawn a period
 * past both edges, so shifting the sea left by one period (`sea-drift` in
 * globals.css) loops without a seam.
 */
const FLUKE = 'M32 24.6C29.5 21.8 25 20.6 20 21C16.5 21.3 13.8 20.6 11.8 19.2C13.2 23.6 17 27.6 22.5 29.6C26.5 31 29.6 31.8 30.4 34L28.5 44.5H35.5L33.6 34C34.4 31.8 37.5 31 41.5 29.6C47 27.6 50.8 23.6 52.2 19.2C50.2 20.6 47.5 21.3 44 21C39 20.6 34.5 21.8 32 24.6Z';
const SEA = 'M-160 300Q-120 282 -80 300T0 300T80 300T160 300T240 300T320 300T400 300T480 300T560 300T640 300T720 300T800 300T880 300T960 300T1040 300T1120 300T1200 300T1280 300T1360 300T1440 300T1520 300T1600 300T1680 300T1760 300V460H-160Z';
const FOAM = 'M-160 338Q-120 348 -80 338T0 338T80 338T160 338T240 338T320 338T400 338T480 338T560 338T640 338T720 338T800 338T880 338T960 338T1040 338T1120 338T1200 338T1280 338T1360 338T1440 338T1520 338T1600 338T1680 338T1760 338';
const FOAM_DEEP = 'M-160 372Q-120 366 -80 372T0 372T80 372T160 372T240 372T320 372T400 372T480 372T560 372T640 372T720 372T800 372T880 372T960 372T1040 372T1120 372T1200 372T1280 372T1360 372T1440 372T1520 372T1600 372T1680 372T1760 372';

export function Sea() {
  return (
    <svg
      viewBox="0 0 1600 460"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className="block h-[clamp(220px,30vw,440px)] w-full"
    >
      <path className="fill-fluke" d={FLUKE} transform="translate(960 310) rotate(-15) scale(8.6) translate(-32 -44)" />
      <g className="sea-drift">
        <path className="fill-ocean" d={SEA} />
        <path className="fill-none stroke-ocean-foreground opacity-90" strokeWidth={7} strokeLinecap="round" d={FOAM} />
        <path className="fill-none stroke-ocean-foreground opacity-55" strokeWidth={4} strokeLinecap="round" d={FOAM_DEEP} />
      </g>
    </svg>
  );
}
