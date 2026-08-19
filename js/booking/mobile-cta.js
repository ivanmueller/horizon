/* ─────────────────────────────────────────────────────────────────────────
   Horizon booking engine · mobile sticky CTA + bottom sheet
   ─────────────────────────────────────────────────────────────────────────
   On phones the booking panel lives in a bottom sheet behind a sticky bar.
   On desktop the same button scrolls to the panel and pops the calendar.
   The breakpoint here (960px) must match the CSS that hides the bar.
   ───────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  function init(ctx) {
    var sel = ctx.sel, cls = ctx.cls;

    var ctaBar   = sel('mobileCta');
    var ctaPrice = sel('mobileCtaPrice');
    var ctaBtn   = sel('mobileCtaBtn');
    var backdrop = sel('mobileSheetBackdrop');
    var closeBtn = sel('mobileSheetClose');
    // Optional by design: a layout with no sticky mobile bar is legitimate.
    if (!ctaBar || !ctaBtn) return null;

    function updateCtaPrice() {
      var amt = global.BOKUN && global.BOKUN.lowestAdultPrice;
      var currency = (global.BOKUN && global.BOKUN.currency) || 'CAD';
      if (amt != null && ctaPrice) {
        ctaPrice.innerHTML = '$' + amt +
          '<span class="' + cls('mobileCtaUnit') + '"> ' + currency + ' per person</span>';
      }
    }

    // Must agree with the CSS breakpoint that shows/hides the bar.
    function isMobile() { return global.innerWidth <= ctx.opts.mobileBreakpoint; }

    function openSheet()  { document.body.classList.add(cls('sheetOpen')); }
    function closeSheet() { document.body.classList.remove(cls('sheetOpen')); }

    ctaBtn.addEventListener('click', function () {
      if (isMobile()) { openSheet(); return; }
      // Desktop: scroll to the panel, then open the calendar once the smooth
      // scroll has settled.
      var panel = sel('bookAnchor');
      if (!panel) return;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () {
        var dateBtn = sel('dateBtn');
        if (dateBtn) dateBtn.click();
      }, 500);
    });

    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    if (backdrop) backdrop.addEventListener('click', closeSheet);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains(cls('sheetOpen'))) closeSheet();
    });

    return { onBokunReady: updateCtaPrice, openSheet: openSheet, closeSheet: closeSheet };
  }

  global.HorizonBookingMobileCta = { init: init };
})(window);
