const button = document.getElementById('toggle');

let pointerDown = false;
let moved = false;
let startX = 0;
let startY = 0;
let startWinX = 0;
let startWinY = 0;
const threshold = 4;

const onPointerDown = (event) => {
  if (event.button !== 0) return;
  pointerDown = true;
  moved = false;
  startX = event.screenX;
  startY = event.screenY;
  startWinX = window.screenX || 0;
  startWinY = window.screenY || 0;
};

const onPointerMove = (event) => {
  if (!pointerDown) return;
  const dx = event.screenX - startX;
  const dy = event.screenY - startY;
  if (!moved && Math.abs(dx) + Math.abs(dy) < threshold) return;
  moved = true;
  window.shortcutApi.moveTo(startWinX + dx, startWinY + dy);
};

const onPointerUp = () => {
  if (!pointerDown) return;
  pointerDown = false;
  if (!moved) {
    window.shortcutApi.toggle();
  }
};

button.addEventListener('mousedown', onPointerDown);
window.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);
window.addEventListener('mouseleave', onPointerUp);

// Listen for recording status from Main
if (window.shortcutApi && window.shortcutApi.onRecordingStatus) {
  window.shortcutApi.onRecordingStatus((isRecording) => {
    const dot = document.getElementById('rec-dot');
    if (dot) {
      if (isRecording) dot.classList.add('active');
      else dot.classList.remove('active');
    }
  });
}
