/* ============================================================
   WILD ATLAS TOURS — Main JavaScript
   Handles: Navbar scroll, Mobile menu, FAQ accordion,
   Scroll animations, Smooth scroll links
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // === NAVBAR SCROLL EFFECT ===
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    const onScroll = () => {
      navbar.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // === MOBILE MENU ===
  const mobileToggle = document.querySelector('.navbar__mobile-toggle');
  const mobileMenu = document.querySelector('.navbar__mobile-menu');
  
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('is-open');
      mobileToggle.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('is-open');
        mobileToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });
  }

  // === FAQ ACCORDION ===
  document.querySelectorAll('.faq-item__trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.faq-item');
      const isOpen = item.classList.contains('is-open');
      
      // Close all other items in same container
      const container = item.parentElement;
      container.querySelectorAll('.faq-item.is-open').forEach(openItem => {
        if (openItem !== item) {
          openItem.classList.remove('is-open');
          openItem.querySelector('.faq-item__trigger').setAttribute('aria-expanded', 'false');
        }
      });
      
      item.classList.toggle('is-open', !isOpen);
      trigger.setAttribute('aria-expanded', !isOpen);
    });
  });

  // === SCROLL-TRIGGERED ANIMATIONS ===
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        // Unobserve after animation
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.fade-in, .stagger-children').forEach(el => {
    observer.observe(el);
  });

  // === SMOOTH SCROLL FOR ANCHOR LINKS ===
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // === BOOKING DATE PICKER (basic placeholder) ===
  const dateInputs = document.querySelectorAll('.booking-panel__input[type="date"]');
  dateInputs.forEach(input => {
    // Set min date to today
    const today = new Date().toISOString().split('T')[0];
    input.setAttribute('min', today);
  });

  // === GUEST COUNTER ===
  const guestInput = document.querySelector('.booking-panel__input[type="number"]');
  if (guestInput) {
    guestInput.addEventListener('change', () => {
      const price = parseFloat(guestInput.dataset.price || 249);
      const total = price * parseInt(guestInput.value || 1);
      const totalEl = document.querySelector('.booking-panel__total-price');
      if (totalEl) {
        totalEl.textContent = `$${total} CAD`;
      }
    });
  }

});
