// The 3D mark in the fixed header.
//
// Builds the depth layers behind the flat logo and adds the light sweep. The
// mark itself does not move: it holds the pose set in the stylesheet, and the
// sweep is a CSS animation on the top layer. Nothing here is needed for the
// page to work: with scripts off the header shows the flat mark, which is the
// old header.
(function () {
  var stage = document.querySelector('.logo3d-stage');
  var face = stage && stage.querySelector('.logo3d-face');
  if (!stage || !face) return;

  var LAYERS = 36;   // copies that make up the thickness, 1px apart
  var BACK = 0.34;   // brightness of the deepest layer
  var FRONT = 0.52;  // brightness of the layer just behind the face

  // Back to front, so the face is painted last.
  for (var i = LAYERS; i >= 1; i--) {
    var layer = face.cloneNode(false);
    layer.className = 'logo3d-layer';
    layer.style.transform = 'translateZ(' + (-i) + 'px)';
    // Slightly lighter towards the front, which reads as light falling on
    // the side of the object rather than a flat grey slab.
    var t = 1 - (i - 1) / (LAYERS - 1);
    layer.style.filter = 'brightness(' + (BACK + (FRONT - BACK) * t).toFixed(3) + ') saturate(0.5)';
    stage.insertBefore(layer, face);
  }
  face.style.transform = 'translateZ(0.5px)';

  var sheen = document.createElement('span');
  sheen.className = 'logo3d-sheen';
  sheen.style.transform = 'translateZ(1px)';
  stage.appendChild(sheen);
})();
