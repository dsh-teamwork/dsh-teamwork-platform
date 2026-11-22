// The Teamwork bar above native DSH Web (ADR 0065): the computer's state and
// traffic from /__dsh/status every two seconds, and ending the session. It
// reads no data of DSH's own.
const words = JSON.parse(document.body.dataset.words);
const $ = (id) => document.getElementById(id);
const dot = $('dot'), rate = $('rate'), dial = $('dial'), end = $('end');
let last, stopped = false;

const perSecond = (bytes) => {
  if (bytes < 1024) return `${Math.round(bytes)} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
};

function finish() {
  stopped = true;
  $('dsh').remove();
  $('ended').hidden = false;
  dot.dataset.state = 'off';
  dot.title = '';
  rate.textContent = dial.textContent = '';
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
