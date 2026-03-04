/* ============================================================
   WILD ATLAS TOURS — Main JavaScript
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Signal that JS is loaded — reveal animations only activate with this class
  document.documentElement.classList.add('js-loaded');

  initNavigation();
  initScrollReveal();
  initFAQ();
  initMobileMenu();
});

/* --- Navigation Scroll Behavior --- */
function initNavigation() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const isTransparent = nav.classList.contains('nav--transparent');

  function updateNav() {
    if (window.scrollY > 60) {
      nav.classList.remove('nav--transparent');
      nav.classList.add('nav--solid');
    } else if (isTransparent) {
      nav.classList.remove('nav--solid');
      nav.classList.add('nav--transparent');
    }
  }

  if (isTransparent) {
    window.addEventListener('scroll', updateNav, { passive: true });
    updateNav();
  }
}

/* --- Scroll Reveal Animations --- */
function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px',
    }
  );

  reveals.forEach((el) => observer.observe(el));
}

/* --- FAQ Accordion --- */
function initFAQ() {
  const faqItems = document.querySelectorAll('.faq-item');
  if (!faqItems.length) return;

  faqItems.forEach((item) => {
    const question = item.querySelector('.faq-item__question');
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');

      // Close all others
      faqItems.forEach((other) => other.classList.remove('active'));

      // Toggle current
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}

/* --- Mobile Menu --- */
function initMobileMenu() {
  const toggle = document.querySelector('.nav__mobile-toggle');
  const links = document.querySelector('.nav__links');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
    links.classList.toggle('active');
    document.body.style.overflow = links.classList.contains('active') ? 'hidden' : '';
  });

  // Close menu when clicking a link
  links.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      toggle.classList.remove('active');
      links.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

// Shared Footer
function initFooter() {
  var el = document.getElementById('site-footer');
  if (!el) return;
  el.innerHTML = `
  <footer class="footer" role="contentinfo">
    <div class="container">
      <div class="footer__grid">
        <div>
          <a href="/" class="nav__logo" style="color:white; margin-bottom: var(--space-2); display: inline-flex;">
            <span class="nav__logo-icon"><svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="8" fill="#FF6B4A"/><path d="M13 7v22M13 18c0-6 12-6 12 0v11" stroke="white" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span>
            <span class="nav__logo-text" style="font-family:'Plus Jakarta Sans',sans-serif;font-size:1.5rem;color:#FF6B4A;font-weight:700;">horizon</span> tours
          </a>
          <p class="footer__brand-desc">Premium guided experiences in Banff National Park and the Canadian Rockies. Locally owned, small-group focused.</p>
        </div>

        <div>
          <h4 class="footer__heading">Experiences</h4>
          <a href="/tours/lake-louise-sunrise-canoe/" class="footer__link">Sunrise Canoe</a>
          <a href="/tours/lake-louise-moraine-lake-canoe/" class="footer__link">Canoe & Sightseeing</a>
          <a href="/tours/lake-louise-moraine-lake-sightseeing/" class="footer__link">Sightseeing Tour</a>
          <a href="/tours/" class="footer__link">All Tours</a>
        </div>

        <div>
          <h4 class="footer__heading">Company</h4>
          <a href="/about/" class="footer__link">About Us</a>
          <a href="/contact/" class="footer__link">Contact</a>
          <a href="/blog/" class="footer__link">Blog</a>
          <a href="/#faq" class="footer__link">FAQ</a>
        </div>

        <div>
          <h4 class="footer__heading">Get In Touch</h4>
          <a href="mailto:hello@gowithhorizon.com" class="footer__link">hello@gowithhorizon.com</a>
          <a href="tel:+14035551234" class="footer__link">+1 (403) 555-1234</a>
          <p class="footer__link" style="cursor:default;">Banff, Alberta, Canada</p>
        </div>
      </div>

      <div class="footer__bottom">
        <p>&copy; 2025 Horizon Tours. All rights reserved.</p>
        <div class="footer__socials">
          <a href="#" class="footer__social-link" aria-label="Instagram">📷</a>
          <a href="#" class="footer__social-link" aria-label="Facebook">f</a>
          <a href="#" class="footer__social-link" aria-label="TripAdvisor">✈</a>
        </div>
      </div>
    </div>
  </footer>`;
}
initFooter();