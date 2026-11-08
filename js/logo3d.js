// The 3D mark in the fixed header.
//
// Builds the depth layers behind the flat logo and adds the light sweep. At
// rest the mark faces forward, as the flat logo did; the extruded edge shows
// because each layer is offset a fraction down and to the right as well as
// back. While the pointer is over the mark it tilts a few degrees towards
// the pointer and eases back when the pointer leaves. Nothing here is needed
// for the page to work: with scripts off the header shows the flat mark.
(function () {
  var box = document.querySelector('.logo3d');
  var stage = box && box.querySelector('.logo3d-stage');
  var face = stage && stage.querySelector('.logo3d-face');
  if (!box || !stage || !face) return;

  var LAYERS = 8;     // copies that make up the thickness
  var SHIFT = 0.45;   // px each layer moves right and down: the visible edge
  var BACK = 0.34;    // brightness of the deepest layer
  var FRONT = 0.52;   // brightness of the layer just behind the face

  for (var i = LAYERS; i >= 1; i--) {
    var layer = face.cloneNode(false);
    layer.className = 'logo3d-layer';
    layer.style.transform = 'translate3d(' + (i * SHIFT) + 'px, ' + (i * SHIFT) + 'px, ' + (-i) + 'px)';
    var t = 1 - (i - 1) / (LAYERS - 1);
    layer.style.filter = 'brightness(' + (BACK + (FRONT - BACK) * t).toFixed(3) + ') saturate(0.5)';
    stage.insertBefore(layer, face);
  }
  // The face stays at z = 0 so perspective never resamples it: it is the
  // same crisp image as the flat logo, with the edge painted behind it.

  var sheen = document.createElement('span');
  sheen.className = 'logo3d-sheen';
  sheen.style.transform = 'translateZ(1px)';
  stage.appendChild(sheen);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // A slight tilt towards the pointer, only while it is over the mark.
  var MAX = 7; // degrees
  box.addEventListener('pointermove', function (e) {
    var r = box.getBoundingClientRect();
    var nx = (e.clientX - r.left) / r.width - 0.5;
    var ny = (e.clientY - r.top) / r.height - 0.5;
    stage.style.transform = 'rotateX(' + (-ny * MAX * 2).toFixed(2) + 'deg) rotateY(' + (nx * MAX * 2).toFixed(2) + 'deg)';
  });
  box.addEventListener('pointerleave', function () {
    stage.style.transform = '';
  });
})();
