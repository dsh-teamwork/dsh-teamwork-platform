/**
 * The horizon, swimming shadows and seabed share the landscape behind the story.
 * The text and controls remain in normal document flow above the artwork.
 */
const FLUKE = 'M32 24.6C29.5 21.8 25 20.6 20 21C16.5 21.3 13.8 20.6 11.8 19.2C13.2 23.6 17 27.6 22.5 29.6C26.5 31 29.6 31.8 30.4 34L28.5 44.5H35.5L33.6 34C34.4 31.8 37.5 31 41.5 29.6C47 27.6 50.8 23.6 52.2 19.2C50.2 20.6 47.5 21.3 44 21C39 20.6 34.5 21.8 32 24.6Z';

/** One engraving tile for the surface fluke and the solitary swimmer. */
function WhaleHatching({ id, transform }: { id: string; transform: string }) {
  return (
    <pattern id={id} width="1" height=".48" patternUnits="userSpaceOnUse" patternTransform={transform}>
      <rect width="1" height=".48" fill="var(--whale-ink)" />
      <path d="M0 .24H1" stroke="var(--whale-grain)" strokeWidth=".13" />
    </pattern>
  );
}

export function SeaSurface() {
  return (
    <div className="tide-surface" aria-hidden="true">
      <svg className="tide-fluke" viewBox="4 10 50 40">
        <defs>
          <WhaleHatching id="fluke-hatching" transform="rotate(76)" />
        </defs>
        <path d={FLUKE} transform="rotate(-15 32 42)" fill="url(#fluke-hatching)" />
      </svg>
      <div className="tide-water">
        <img src="/home/tide-water.webp" alt="" width="1080" height="1065" />
        <canvas hidden />
      </div>
    </div>
  );
}

/** A submerged humpback seen obliquely, with the tail stock and long pectoral fin in shadow. */
function WhaleShadow({ className, engraved = false }: { className: string; engraved?: boolean }) {
  const hatch = `${className}-hatch`;
  const outline = `${className}-outline`;
  return (
    <svg className={className} viewBox="0 0 600 220" aria-hidden="true">
      <defs>
        {engraved && <WhaleHatching id={hatch} transform="scale(8)" />}
        <clipPath id={outline}>
          <path className="whale-tail" d="M166 96C130 96 96 97 75 88C65 73 39 67 10 49C18 72 36 86 53 92L66 98C49 103 30 116 19 137C43 134 67 124 83 106C104 102 133 106 166 103Z" />
          <path className="whale-fin" d="M415 118C397 132 367 156 342 176C324 190 298 203 272 201C293 190 304 171 315 153C327 133 340 119 353 112Z" />
          <path d="M109 99C137 95 161 87 184 78C192 75 196 67 191 61C203 61 211 67 223 66C272 60 313 40 374 39C438 37 483 51 522 55C548 58 567 54 578 61C586 67 584 78 576 88C560 107 537 122 507 133C455 152 399 154 344 144C285 134 239 114 201 111C163 109 133 107 109 104Z" />
        </clipPath>
      </defs>
      <rect width="600" height="220" clipPath={`url(#${outline})`} fill={engraved ? `url(#${hatch})` : 'currentColor'} />
    </svg>
  );
}

export function WhalePassage() {
  return (
    <div className="tide-swim-zone" aria-hidden="true">
      <div className="tide-passage">
        <WhaleShadow className="whale-traveller" engraved />
      </div>
    </div>
  );
}

export function WhalePod() {
  return (
    <div className="tide-pod" aria-hidden="true">
      <WhaleShadow className="whale-distant" />
      <WhaleShadow className="whale-calf" />
      <WhaleShadow className="whale-lead" />
    </div>
  );
}

export function SeaBed() {
  return (
    <svg className="tide-bed" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true">
      <path fill="#1c303a" d="M0 24C79 29 131 50 229 52S384 61 465 65C602 73 714 61 796 54S930 50 997 37C1073 24 1148 27 1200 18V100H0Z" />
      <path fill="var(--sediment)" d="M0 44C86 48 131 62 202 63S326 67 409 75C545 85 652 79 734 73S916 65 987 56C1078 45 1147 49 1200 40V100H0Z" />
    </svg>
  );
}
