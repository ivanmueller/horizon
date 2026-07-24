/* Horizon Raft — homepage behaviour
   1. Nav: transparent over the hero, Sandbar + blur past 80px
   2. Mobile menu: full-screen Alpine overlay with focus trap
   3. Sticky mobile "Book Now" bar: hides on scroll up, returns on scroll down
   4. Scroll reveal: sections fade up once as they enter the viewport
*/
(function () {
  'use strict';

  var SCROLL_THRESHOLD = 80;   // px before the nav switches to its Sandbar state
  var DIRECTION_DELTA = 6;     // px of movement before the book bar reacts

  var nav = document.getElementById('site-nav');
  var toggle = document.getElementById('nav-toggle');
  var closeBtn = document.getElementById('nav-close');
  var menu = document.getElementById('mobile-menu');
  var bookBar = document.getElementById('book-bar');

  var lastY = window.pageYOffset;
  var ticking = false;

  /* ---------- 1 + 3: scroll state ---------- */

  function onScroll() {
    var y = window.pageYOffset;

    if (nav) nav.classList.toggle('is-scrolled', y > SCROLL_THRESHOLD);

    if (bookBar && !isMenuOpen()) {
      var delta = y - lastY;
      if (Math.abs(delta) > DIRECTION_DELTA) {
        // Plan §7: disappears when scrolling up, reappears when scrolling down.
        bookBar.classList.toggle('is-hidden', delta < 0);
      }
      // Always available once the page bottom is in reach.
      if (y + window.innerHeight > document.body.scrollHeight - 120) {
        bookBar.classList.remove('is-hidden');
      }
    }

    lastY = y;
    ticking = false;
  }

  function requestScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(onScroll);
  }

  window.addEventListener('scroll', requestScroll, { passive: true });
  onScroll();

  /* ---------- 2: mobile menu ---------- */

  function isMenuOpen() {
    return !!menu && !menu.hasAttribute('hidden');
  }

  function focusables() {
    if (!menu) return [];
    return Array.prototype.slice.call(
      menu.querySelectorAll('a[href], button:not([disabled])')
    );
  }

  function openMenu() {
    if (!menu || !toggle) return;
    menu.removeAttribute('hidden');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    if (bookBar) bookBar.classList.add('is-hidden');
    var first = focusables()[0];
    if (first) first.focus();
  }

  function closeMenu(returnFocus) {
    if (!menu || !toggle) return;
    menu.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (bookBar) bookBar.classList.remove('is-hidden');
    if (returnFocus !== false) toggle.focus();
  }

  if (toggle) toggle.addEventListener('click', function () {
    if (isMenuOpen()) closeMenu(); else openMenu();
  });
  if (closeBtn) closeBtn.addEventListener('click', function () { closeMenu(); });

  if (menu) {
    // Any link tap closes the overlay so the anchor scroll is visible.
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a[href]')) closeMenu(false);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (!isMenuOpen()) return;

    if (e.key === 'Escape') {
      closeMenu();
      return;
    }

    if (e.key !== 'Tab') return;
    var items = focusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Leaving the mobile breakpoint with the menu open would strand the overlay.
  var wide = window.matchMedia('(min-width: 941px)');
  var onBreakpoint = function (e) { if (e.matches && isMenuOpen()) closeMenu(false); };
  if (wide.addEventListener) wide.addEventListener('change', onBreakpoint);
  else if (wide.addListener) wide.addListener(onBreakpoint);

  /* ---------- 4: scroll reveal ---------- */

  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (!('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);   // one-time only — no re-trigger on scroll up
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

  reveals.forEach(function (el) { observer.observe(el); });
})();
