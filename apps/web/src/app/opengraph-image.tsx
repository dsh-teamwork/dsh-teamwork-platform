import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import en from '@/messages/en.json';

export const alt = en.common.appName;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The logo as `pnpm assets:icons` exports it (docs/design.md, "Exports"), and
// Onest from `assets/fonts` (latin subset, from @fontsource/onest 5.3.1; OFL,
// licence beside the files): bold for the name, regular for the tagline, since
// once a font is given it is the only one the card has. `.woff`, because the
// card's renderer reads no `.woff2`. Read once: none of it depends on the
// request.
const logo = `data:image/svg+xml;base64,${await readFile(join(process.cwd(), 'public/logo.svg'), 'base64')}`;
const onest = (weight: 400 | 700) => readFile(join(process.cwd(), `assets/fonts/onest-latin-${weight}-normal.woff`));
const [onestRegular, onestBold] = await Promise.all([onest(400), onest(700)]);

// English on purpose: Onest's latin files carry no CJK glyphs, and a share
// card is fetched by a crawler with no language of its own. The brand's hexes,
// because this renders outside the stylesheet (docs/design.md, "Component
// rules"): paper ground, the logo on its indigo plate, indigo-tinted ink.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 64,
          padding: 96,
          background: '#f8f5ef',
          color: '#101524',
          fontFamily: 'Onest',
        }}
      >
        <img src={logo} width={240} height={240} alt="" />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 84, letterSpacing: -2 }}>{en.common.appName}</div>
          <div style={{ fontWeight: 400, marginTop: 24, fontSize: 36, lineHeight: 1.35, color: '#555b69' }}>{en.home.tagline}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Onest', data: onestRegular, weight: 400, style: 'normal' },
        { name: 'Onest', data: onestBold, weight: 700, style: 'normal' },
      ],
    },
  );
}
