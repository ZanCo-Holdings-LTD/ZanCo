// The 3D mark in the fixed header.
//
// Builds the depth layers behind the flat logo, adds the light sweep, and
// steers the stage towards the pointer when it is near. When the pointer is
// away the stage falls back to the slow CSS turn animation. Nothing here is
// needed for the page to work: with scripts off the header shows the flat
// mark, which is the old header.
(function () {
  var stage = document.querySelector('.logo3d-stage');
  var face = stage && stage.querySelector('.logo3d-face');
  if (!stage || !face) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LAYERS = 22;      // how many copies make up the thickness
  var STEP = 1;         // px between copies, so ~22px deep

  // Depth layers, back to front, behind the face.
  for (var i = LAYERS; i >= 1; i--) {
    var layer = face.cloneNode(false);
    layer.className = 'logo3d-layer';
    layer.style.transform = 'translateZ(' + (-i * STEP) + 'px)';
    stage.insertBefore(layer, face);
  }
  face.style.transform = 'translateZ(0.5px)';

  var sheen = document.createElement('span');
  sheen.className = 'logo3d-sheen';
  sheen.style.transform = 'translateZ(1px)';
  stage.appendChild(sheen);

  if (reduce) return;           // static angled pose, no motion at all
  stage.classList.add('is-idle');

  // Pointer steering. Only while the pointer is within the header, so the
  // mark does not twitch at the page's every scroll.
  var header = stage.closest('.topbar') || document.body;
  var target = null, current = { x: 12, y: -28 }, raf = 0, idleTimer = 0;

  function frame() {
    raf = 0;
    if (!target) return;
    current.x += (target.x - current.x) * 0.12;
    current.y += (target.y - current.y) * 0.12;
    stage.style.transform = 'rotateX(' + current.x.toFixed(2) + 'deg) rotateY(' + current.y.toFixed(2) + 'deg)';
    if (Math.abs(target.x - current.x) > 0.05 || Math.abs(target.y - current.y) > 0.05) {
      raf = requestAnimationFrame(frame);
    }
  }

  header.addEventListener('pointermove', function (e) {
    var r = header.getBoundingClientRect();
    var nx = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
    var ny = (e.clientY - r.top) / r.height - 0.5;
    target = { x: 12 - ny * 30, y: nx * 110 };
    stage.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (!raf) raf = requestAnimationFrame(frame);
  });

  header.addEventListener('pointerleave', function () {
    target = null;
    // Let the pose settle, then hand back to the idle turn.
    idleTimer = setTimeout(function () {
      stage.style.transform = '';
      stage.classList.add('is-idle');
    }, 600);
  });
})();
