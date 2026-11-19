/**
 * The woodcut follows the reader into deep water. At the surface, two swells
 * travel through the engraved water independently of the reader's scroll.
 */

import { surfaceBreaches } from './breach';

export function followTide(story: HTMLElement) {
  const surface = story.querySelector<HTMLElement>('.tide-surface')!;
  const swimZone = story.querySelector<HTMLElement>('.tide-swim-zone')!;
  const traveller = swimZone.querySelector<SVGSVGElement>('.whale-traveller')!;
  traveller.pauseAnimations();
  const deep = story.querySelector<HTMLElement>('.tide-deep')!;
  const arrival = story.querySelector<HTMLElement>('.tide-arrival')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let surfaceHeight = 1;
  let surfaceEnd = 0;
  let assetStart = 0;
  let podStart = 0;
  let frame = 0;
  const unit = (value: number) => Math.max(0, Math.min(1, value));

  function paint() {
    frame = 0;
    const y = window.scrollY;
    const inWater = y >= surfaceEnd && y + innerHeight <= podStart;
    swimZone.classList.toggle('whale-in-water', inWater);
    if (inWater && !document.hidden && !reduced.matches) {
      if (traveller.animationsPaused()) {
        if (!traveller.querySelector('animate')) addSwimStroke(traveller);
        traveller.unpauseAnimations();
      }
    } else if (!traveller.animationsPaused()) {
      traveller.pauseAnimations();
    }
    swimZone.classList.toggle('whale-in-deep', y > assetStart + innerHeight * .5);
    if (reduced.matches) return;
    const dive = unit(y / surfaceHeight);
    surface.style.setProperty('--wave-lift', -dive * 22 + '%');
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function measure() {
    surfaceHeight = Math.max(1, surface.offsetHeight);
    const surfaceBottom = surface.getBoundingClientRect().bottom;
    const arrivalTop = arrival.getBoundingClientRect().top;
    swimZone.style.setProperty('--swim-start', (surfaceBottom - story.getBoundingClientRect().top) + 'px');
    swimZone.style.setProperty('--swim-length', (arrivalTop - surfaceBottom) + 'px');
    surfaceEnd = surfaceBottom + scrollY;
    podStart = arrivalTop + scrollY;
    assetStart = deep.getBoundingClientRect().top + scrollY - innerHeight;
    schedule();
  }
  animateWater(surface, reduced);
  measure();
  new ResizeObserver(measure).observe(story);
  window.addEventListener('resize', measure);
  window.addEventListener('scroll', schedule, { passive: true });
  reduced.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
}

/** Bend all three outlines along the same spine so the fins stay attached. */
function addSwimStroke(whale: SVGSVGElement) {
  for (const path of whale.querySelectorAll('clipPath path')) {
    const outline = path.getAttribute('d')!;
    const poses = Array.from({ length: 12 }, (_, step) => {
      const phase = 2 * Math.PI * step / 12;
      // The outlines use absolute x/y pairs. The wave arrives later and
      // travels farther at the tail than at the heavier head.
      return outline.replace(/(\d+) (\d+)/g, (_, x: string, y: string) => {
        const aft = 1 - Number(x) / 600;
        const lift = (6 + 34 * aft * aft) * Math.sin(phase - 3.4 * aft);
        return x + ' ' + (Number(y) + lift).toFixed(2);
      });
    });
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    stroke.setAttribute('attributeName', 'd');
    stroke.setAttribute('dur', '8s');
    stroke.setAttribute('repeatCount', 'indefinite');
    stroke.setAttribute('values', [...poses, poses[0]].join(';'));
    path.append(stroke);
  }
}

function animateWater(surface: HTMLElement, reduced: MediaQueryList) {
  const water = surface.querySelector<HTMLElement>('.tide-water')!;
  const drawPod = surfaceBreaches(surface);
  drawPod(0);
  const image = water.querySelector('img')!;
  const canvas = water.querySelector('canvas')!;
  const brush = canvas.getContext('2d');
  if (!brush) return;
  let width = 0;
  let height = 0;
  const headroom = 16;
  let scale = 1;
  let visible = false;
  let frame = 0;
  let time = 0;
  let previous = 0;

  const draw = (now: number) => {
    if (previous) time += (now - previous) / 1000;
    previous = now;
    drawPod(time);
    const length = Math.min(410, width * .8);
    const amplitude = Math.min(10, length * .024);
    // Different wavelengths and speeds make each crest grow, travel and
    // flatten as it meets the other train. Time is continuous between frames.
    function swell(x: number) {
      const phase = x * 2 * Math.PI / length;
      return amplitude * (Math.sin(phase - time * .86) + .38 * Math.sin(phase * 1.87 - time * 1.16));
    }

    brush.resetTransform();
    brush.clearRect(0, 0, canvas.width, canvas.height);
    const sourceScale = image.naturalWidth / width;
    const step = Math.max(8, Math.round(length / 28));
    let left = swell(0);
    for (let x = 0; x < width; x += step) {
      const span = Math.min(step, width - x);
      const right = swell(x + span);
      // Shear each narrow strip between its two wave heights so neighboring
      // pieces of every ink line meet. A one-pixel overlap covers raster seams.
      const painted = Math.min(width - x, span + 1 / scale);
      brush.setTransform(scale, scale * (right - left) / span, 0, scale, scale * x, scale * (headroom + left));
      brush.drawImage(image, x * sourceScale, 0, painted * sourceScale, image.naturalHeight, 0, 0, painted, height);
      left = right;
    }
    image.hidden = true;
    frame = requestAnimationFrame(draw);
  };

  function sync() {
    const running = visible && !document.hidden && !reduced.matches && width > 0 && height > 0 && image.complete && image.naturalWidth > 0;
    if (!running) {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (reduced.matches) drawPod(0);
      canvas.hidden = true;
      image.hidden = false;
      return;
    }
    canvas.hidden = false;
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function resize() {
    width = water.clientWidth;
    height = water.clientHeight;
    canvas.style.height = (height + headroom) + 'px';
    scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil((height + headroom) * scale);
    sync();
  }
  new ResizeObserver(resize).observe(water);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(surface);
  image.addEventListener('load', sync);
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
}
