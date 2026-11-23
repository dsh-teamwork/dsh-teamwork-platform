// The Teamwork bar above native DSH Web (ADR 0065): the computer's state,
// traffic and how long the session has lasted from /__dsh/status every two
// seconds, and ending the session. It
// reads no data of DSH's own.
const words = JSON.parse(document.body.dataset.words);
const $ = (id) => document.getElementById(id);
const dot = $('dot'), rate = $('rate'), dial = $('dial'), since = $('since'), end = $('end');
let last, entered, stopped = false;

const perSecond = (bytes) => {
  if (bytes < 1024) return `${Math.round(bytes)} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
};

// The session's age, counted on this clock from the server's figure, so a
// skewed clock never shows a wrong duration.
const duration = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const tick = () => {
  if (stopped || entered == null) return;
  since.textContent = duration(performance.now() - entered);
  since.parentElement.hidden = false;
};
setInterval(tick, 1000);

function finish() {
  stopped = true;
  $('dsh').remove();
  $('ended').hidden = false;
  dot.dataset.state = 'off';
  dot.title = '';
  rate.textContent = dial.textContent = '';
  since.parentElement.hidden = true;
  end.disabled = true;
}

async function poll() {
  if (stopped) return;
  try {
    const response = await fetch('/__dsh/status', { cache: 'no-store' });
    if (response.status === 404) return finish();
    const status = await response.json();
    const now = performance.now();
    if (last) {
      const seconds = (now - last.at) / 1000;
      const traffic = `↑ ${perSecond((status.up - last.up) / seconds)}  ↓ ${perSecond((status.down - last.down) / seconds)}`;
      rate.textContent = traffic;
      dot.title = `${words[status.connected ? 'shell.connected' : 'shell.reconnecting']} · ${traffic}`;
    }
    last = { at: now, up: status.up, down: status.down };
    entered = now - status.sinceMs;
    tick();
    dot.dataset.state = status.connected ? 'on' : 'wait';
    dial.textContent = status.dialMs == null ? '' : words['shell.dial'].replace('{ms}', String(status.dialMs));
  } catch {
    dot.dataset.state = 'wait';
  }
  setTimeout(poll, 2000);
}

end.addEventListener('click', async () => {
  end.disabled = true;
  await fetch('/__dsh/end', { method: 'POST' }).catch(() => {});
  finish();
});
poll();
