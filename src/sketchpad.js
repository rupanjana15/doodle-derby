// In-game sketch pad: draw a car, save it as a PNG to upload to Vi3W.
const $ = (id) => document.getElementById(id);

export function initSketchpad(onSaved) {
  const modal = $('sketchpad');
  const canvas = $('sketch-canvas');
  const ctx = canvas.getContext('2d');
  let tool = 'pen', drawing = false, last = null;

  const clear = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  clear();

  const toolButtons = modal.querySelectorAll('[data-tool]');
  const setTool = (t) => {
    tool = t;
    toolButtons.forEach((b) => b.classList.toggle('sel', b.dataset.tool === t));
  };
  toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  setTool('pen');

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.arc(last[0], last[1], tool === 'pen' ? 2.5 : 14, 0, Math.PI * 2);
    ctx.fillStyle = tool === 'pen' ? '#1d1b1a' : '#fff'; ctx.fill();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.strokeStyle = tool === 'pen' ? '#1d1b1a' : '#fff';
    ctx.lineWidth = tool === 'pen' ? 5 : 28;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
    last = p;
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  $('sk-clear').addEventListener('click', clear);
  $('sk-close').addEventListener('click', () => modal.classList.add('hidden'));
  $('sk-save').addEventListener('click', () => {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = 'my-car-sketch.png'; a.click();
    onSaved(url);
  });

  return { open: () => modal.classList.remove('hidden') };
}
