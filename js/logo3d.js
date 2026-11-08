// The 3D mark in the fixed header.
//
// Builds the depth layers behind the flat logo and adds the light sweep. The
// mark faces forward; the extruded edge shows because each layer is offset a
// fraction down and to the right as well as back. While the pointer is over
// the mark it tilts a few degrees towards the pointer and eases back. The
// layers are empty spans cut to the shape of the mark by a CSS mask and
// coloured by the --logo3d-side and --logo3d-back tokens in the stylesheet.
// With scripts off the header shows the flat mark alone.
(function () {
  var stage = document.querySelector('.logo3d-stage');
  var face = stage && stage.querySelector('.logo3d-face');
  if (!stage || !face) return;

  var LAYERS = 8;     // layers that make up the thickness
  var BACK = 2;       // how many of the deepest layers are the dark base
  var SHIFT = 0.45;   // px each layer moves right and down: the visible edge

  for (var i = LAYERS; i >= 1; i--) {
    var layer = document.createElement('span');
    layer.className = 'logo3d-layer' + (i > LAYERS - BACK ? ' logo3d-layer--back' : '');
    layer.style.transform = 'translate3d(' + (i * SHIFT) + 'px, ' + (i * SHIFT) + 'px, ' + (-i) + 'px)';
    stage.insertBefore(layer, face);
  }

  var sheen = document.createElement('span');
  sheen.className = 'logo3d-sheen';
  sheen.style.transform = 'translateZ(1px)';
  stage.appendChild(sheen);

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // A slight tilt towards the pointer, only while it is over the mark.
  var box = stage.parentNode;
  var MAX = 4; // degrees, each way
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
