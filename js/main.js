// Mobile navigation toggle. The only script on the site.
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.querySelector('.menu-toggle');
  var links = document.querySelector('.navlinks');
  if (!toggle || !links) return;

  function setOpen(open) {
    links.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    toggle.textContent = open ? '×' : '☰';
  }

  toggle.addEventListener('click', function () {
    setOpen(!links.classList.contains('active'));
  });

  links.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && links.classList.contains('active')) {
      setOpen(false);
      toggle.focus();
    }
  });
});
