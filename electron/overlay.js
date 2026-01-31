const screenshot = document.getElementById('screenshot');
const selection = document.getElementById('selection');
const dim = document.getElementById('dim');
const coords = document.getElementById('coords');

let isSelecting = false;
let startPoint = null;
let currentRect = null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getPoint = (event) => {
  const x = clamp(event.clientX, 0, window.innerWidth);
  const y = clamp(event.clientY, 0, window.innerHeight);
  return { x, y };
};

const updateSelection = (point) => {
  if (!startPoint) return;
  const left = Math.min(startPoint.x, point.x);
  const top = Math.min(startPoint.y, point.y);
  const width = Math.abs(startPoint.x - point.x);
  const height = Math.abs(startPoint.y - point.y);

  currentRect = { x: left, y: top, width, height };

  selection.style.display = 'block';
  selection.style.left = `${left}px`;
  selection.style.top = `${top}px`;
  selection.style.width = `${width}px`;
  selection.style.height = `${height}px`;

  coords.style.display = 'block';
  coords.textContent = `${Math.round(width)} x ${Math.round(height)}`;
};

const endSelection = () => {
  if (!isSelecting) return;
  isSelecting = false;

  if (!currentRect || currentRect.width < 2 || currentRect.height < 2) {
    currentRect = null;
    selection.style.display = 'none';
    coords.style.display = 'none';
    dim.style.display = 'block';
    return;
  }

  window.overlayApi.sendSelection(currentRect);
};

window.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  dim.style.display = 'none';
  selection.style.display = 'none';
  coords.style.display = 'none';
  isSelecting = true;
  startPoint = getPoint(event);
  updateSelection(startPoint);
});

window.addEventListener('mousemove', (event) => {
  if (!isSelecting) return;
  updateSelection(getPoint(event));
});

window.addEventListener('mouseup', () => {
  endSelection();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.overlayApi.cancel();
  }
});

window.overlayApi.onInit((payload) => {
  if (payload?.dataUrl) {
    screenshot.src = payload.dataUrl;
  }
});
