/** The seven-second surface scene shares the water's clock and pauses with it. */
const members = [
  { name: 'scout', delay: 0, speed: 1.17 },
  { name: 'follower', delay: 1.48, speed: 1.1 },
  { name: 'leader', delay: .58, speed: 1 },
] as const;

const strokeRate = 30;

/** Bend successive sections from the skull towards the flukes. Transform the
 * Bézier controls along with their endpoints to keep the woodcut smooth. */
function breachPose(outline: string, fin: boolean, t: number) {
  const spine: { x: number; y: number; sin: number; cos: number }[] = [];
  let x = 425;
  let y = 99;
  const thrust = Math.exp(-(((t - .56) / .67) ** 2));
  const entry = Math.exp(-(((t - 2.9) / .68) ** 2));
  for (let i = 425; i >= 0; i--) {
    const aft = (425 - i) / 425;
    const bend = aft * aft * (1.12 * thrust * Math.sin(6.2 * t - 2.45 * aft)
      + .42 * Math.sin(1.65 * t - 2 * aft) - .58 * entry);
    const cos = Math.cos(bend);
    const sin = Math.sin(bend);
    spine[i] = { x, y, sin, cos };
    x -= cos;
    y -= sin;
  }
  const tuck = .5 + .5 * Math.cos(2 * Math.PI * (t / 4 + .08));
  return outline.replace(/(\d+) (\d+)/g, (pair, rawX: string, rawY: string) => {
    let px = Number(rawX);
    let py = Number(rawY);
    if (fin) {
      const reach = Math.max(0, Math.min(1, (py - 119) / 77));
      px -= reach * (17 + 22 * tuck);
      py -= reach * (48 * tuck - 7);
    }
    if (px >= 425) return pair;
    const joint = spine[Math.max(0, Math.round(px))];
    return (joint.x - (py - 99) * joint.sin).toFixed(1) + ' ' + (joint.y + (py - 99) * joint.cos).toFixed(1);
  });
}

export function surfaceBreaches(surface: HTMLElement) {
  const actors = members.map(({ name, delay, speed }) => {
    const whale = surface.querySelector<SVGSVGElement>(`.surface-${name}`)!;
    const wake = surface.querySelector<SVGSVGElement>(`.breach-${name} .breach-wake`)!;
    const spray = wake.querySelector<SVGGElement>('g')!;
    const paths = [...whale.querySelectorAll('clipPath path')];
    return { whale, wake, spray, paths, delay, speed, lastPose: -1 };
  });
  // All members use the same anatomy. Cache one set of poses as they are used.
  const outlines = actors[0].paths.map(path => ({
    d: path.getAttribute('d')!, fin: path.classList.contains('whale-fin'),
  }));
  const poses = new Map<number, string[]>();
  return (time: number) => {
    const clock = (time + 2.45) % 7;
    for (const actor of actors) {
      const t = Math.max(0, (clock - actor.delay) * actor.speed);
      const u = Math.min(1, t / 4);
      // Percent translation uses the SVG's height (220 units per 600 wide).
      const lift = (.59 - 1.03 * 4 * u * (1 - u)) * 600 / 220 * 100;
      actor.whale.style.left = u * 100 + '%';
      actor.whale.style.transform = `translate(-50%, ${lift - 50}%) rotate(${-61 + 125 * u}deg)`;
      const pose = Math.round(u * 4 * strokeRate);
      if (actor.lastPose !== pose) {
        let shapes = poses.get(pose);
        if (!shapes) {
          shapes = outlines.map(({ d, fin }) => breachPose(d, fin, pose / strokeRate));
          poses.set(pose, shapes);
        }
        actor.paths.forEach((path, index) => path.setAttribute('d', shapes[index]));
        actor.lastPose = pose;
      }
      const landing = t > 2.6;
      const p = Math.max(0, Math.min(1, (t - (landing ? 2.65 : .2)) / (landing ? 2.6 : 1.8)));
      actor.wake.style.left = landing ? '116%' : '5%';
      actor.wake.style.transform = `translate(-50%, -50%) scale(${.16 + 1.36 * p})`;
      actor.wake.style.opacity = String(Math.sin(Math.PI * p));
      const splash = Math.sin(Math.PI * Math.min(1, 2 * p));
      actor.spray.setAttribute('transform', `translate(0 ${-32 * splash})`);
      actor.spray.style.opacity = String(splash);
    }
  };
}
