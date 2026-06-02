/**
 * ImageViewer Module
 * 
 * A reusable, performant image viewer with:
 * - Full-screen modal viewer
 * - Smooth horizontal scrolling
 * - Touch gesture handling (pinch to zoom)
 * - Orientation handling
 * - Lazy loading
 * - Keyboard navigation support
 * - Accessibility features (ARIA labels, focus management)
 * 
 * Usage:
 *   imageViewerModule.init(imageCollections);
 *   imageViewerModule.openFullscreen(collectionIndex, imageIndex);
 *   imageViewerModule.closeFullscreen();
 */

const imageViewerModule = (() => {
  // ===== PRIVATE STATE =====
  const state = {
    collections: [],
    currentCollectionIndex: 0,
    currentImageIndex: 0,
    isOpen: false,
    savedScrollY: 0,
    isTouching: false,
    touchStartX: 0,
    touchStartY: 0,
    lastScrollX: 0,
    lastScrollTime: 0,
    pinchStartDistance: 0,
    currentZoom: 1,
    imageCache: new Map(),
    scrollIndicatorTimeout: null,
    lastDoubleTapTime: 0
  };

  // ===== DOM REFERENCES (cached) =====
  let domRefs = {
    modal: null,
    overlay: null,
    container: null,
    imageContainer: null,
    image: null,
    closeBtn: null,
    title: null,
    swipeIndicator: null,
    progressBar: null
  };

  // ===== INITIALIZATION =====
  function init(collections) {
    state.collections = collections;
    cacheDOM();
    setupEventListeners();
  }

  function cacheDOM() {
    domRefs = {
      modal: document.getElementById('fullscreenImageModal'),
      overlay: document.getElementById('modalOverlay'),
      container: document.querySelector('.modal-container'),
      imageContainer: document.getElementById('modalImageContainer'),
      image: document.getElementById('modalImage'),
      closeBtn: document.getElementById('modalCloseBtn'),
      title: document.getElementById('modalTitle'),
      swipeIndicator: document.getElementById('modalSwipeIndicator'),
      progressBar: document.getElementById('modalScrollProgress')
    };
  }

  // ===== SETUP EVENT LISTENERS =====
  function setupEventListeners() {
    if (!domRefs.imageContainer) return;

    // Image container scroll and touch events
    domRefs.imageContainer.addEventListener('scroll', onImageContainerScroll, { passive: true });
    domRefs.imageContainer.addEventListener('touchstart', onTouchStart, { passive: true });
    domRefs.imageContainer.addEventListener('touchmove', onTouchMove, { passive: true });
    domRefs.imageContainer.addEventListener('touchend', onTouchEnd, { passive: true });

    // Close button
    domRefs.closeBtn.addEventListener('click', closeFullscreen);

    // Overlay click to close
    domRefs.overlay.addEventListener('click', closeFullscreen);

    // Prevent drag on image
    domRefs.image.addEventListener('dragstart', (e) => e.preventDefault());

    // Keyboard support
    document.addEventListener('keydown', onKeyDown);

    // History back button
    window.addEventListener('popstate', () => {
      if (state.isOpen) {
        closeFullscreen();
      }
    });

    // Prevent page scroll when modal is open
    domRefs.modal.addEventListener('touchmove', preventModalBackground, { passive: false });
  }

  // ===== PUBLIC API =====
  function openFullscreen(collectionIndex, imageIndex = 0) {
    if (state.isOpen) return;

    state.currentCollectionIndex = collectionIndex;
    state.currentImageIndex = imageIndex;
    state.isOpen = true;
    state.currentZoom = 1;

    // Save scroll position
    state.savedScrollY = window.scrollY || window.pageYOffset;

    // Lock body scroll
    document.body.style.top = `-${state.savedScrollY}px`;
    document.body.classList.add('modal-open');

    // Show modal with animation
    domRefs.modal.classList.add('active');
    domRefs.modal.setAttribute('aria-hidden', 'false');

    // Load and display image
    loadImage(collectionIndex, imageIndex);

    // Update UI
    domRefs.imageContainer.scrollLeft = 0;
    updateProgressBar();
    showSwipeIndicator();

    // Set focus to close button for accessibility
    domRefs.closeBtn.focus();

    // Push history state for back button support
    history.pushState({ modalOpen: true }, '');
  }

  function closeFullscreen() {
    if (!state.isOpen) return;

    state.isOpen = false;
    state.currentZoom = 1;

    // Fade out
    domRefs.modal.classList.remove('active');
    domRefs.modal.setAttribute('aria-hidden', 'true');

    // Restore scroll position
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, state.savedScrollY);

    // Show notification
    if (typeof UIkit !== 'undefined') {
      UIkit.notification({
        message: '<span uk-icon="icon: check"></span> Viewer closed',
        status: 'success',
        pos: 'bottom-center',
        timeout: 1500
      });
    }
  }

  // ===== IMAGE LOADING =====
  function loadImage(collectionIndex, imageIndex) {
    const collection = state.collections[collectionIndex];
    if (!collection || !collection.images[imageIndex]) return;

    const imageData = collection.images[imageIndex];
    const cacheKey = `${collectionIndex}-${imageIndex}`;

    // Update title
    domRefs.title.textContent = imageData.label || 'Image';

    if (state.imageCache.has(cacheKey)) {
      // Use cached image element
      const cachedImg = state.imageCache.get(cacheKey);
      domRefs.imageContainer.innerHTML = '';
      domRefs.imageContainer.appendChild(cachedImg.cloneNode(true));
      return;
    }

    // Create new image element
    const img = document.createElement('img');
    img.src = imageData.src;
    img.alt = imageData.label;
    img.loading = 'lazy';
    
    img.onload = () => {
      domRefs.imageContainer.innerHTML = '';
      domRefs.imageContainer.appendChild(img);
      state.imageCache.set(cacheKey, img.cloneNode(true));
    };

    img.onerror = () => {
      domRefs.imageContainer.innerHTML = '<p style="color: #fff; text-align: center; width: 100%; margin: auto;">Failed to load image</p>';
    };

    domRefs.imageContainer.innerHTML = '';
    domRefs.imageContainer.appendChild(img);
  }

  // ===== SCROLL EVENTS =====
  function onImageContainerScroll(e) {
    const now = performance.now();
    const container = e.target;

    updateProgressBar();
    showSwipeIndicator();

    state.lastScrollX = container.scrollLeft;
    state.lastScrollTime = now;
  }

  // ===== TOUCH HANDLING =====
  function onTouchStart(e) {
    state.isTouching = true;
    state.touchStartX = e.changedTouches[0].screenX;
    state.touchStartY = e.changedTouches[0].screenY;

    // Pinch detection
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      state.pinchStartDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
    }
  }

  function onTouchMove(e) {
    // Pinch zoom support
    if (e.touches.length === 2 && state.pinchStartDistance > 0) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      const zoomDelta = currentDistance / state.pinchStartDistance;
      state.currentZoom = Math.min(Math.max(zoomDelta, 1), 3);
      applyZoom();
    }
  }

  function onTouchEnd(e) {
    state.isTouching = false;
    state.pinchStartDistance = 0;

    // Reset zoom on double-tap
    if (e.changedTouches.length === 1 && state.currentZoom > 1) {
      if (performance.now() - state.lastDoubleTapTime < 300) {
        state.currentZoom = 1;
        applyZoom();
      }
      state.lastDoubleTapTime = performance.now();
    }
  }

  function preventModalBackground(e) {
    // Allow scrolling within modal, prevent body scroll
    if (e.target === domRefs.modal || e.target === domRefs.overlay) {
      e.preventDefault();
    }
  }

  // ===== ZOOM HANDLING =====
  function applyZoom() {
    const img = domRefs.imageContainer.querySelector('img');
    if (img) {
      img.style.transform = `scale(${state.currentZoom})`;
      img.style.transformOrigin = 'center center';
    }
  }

  // ===== KEYBOARD NAVIGATION =====
  function onKeyDown(e) {
    if (!state.isOpen) return;

    switch (e.key) {
      case 'Escape':
        closeFullscreen();
        break;
      case 'ArrowRight':
        nextImage();
        break;
      case 'ArrowLeft':
        previousImage();
        break;
    }
  }

  function nextImage() {
    const collection = state.collections[state.currentCollectionIndex];
    if (state.currentImageIndex < collection.images.length - 1) {
      state.currentImageIndex++;
      loadImage(state.currentCollectionIndex, state.currentImageIndex);
      domRefs.imageContainer.scrollLeft = 0;
      state.currentZoom = 1;
    }
  }

  function previousImage() {
    if (state.currentImageIndex > 0) {
      state.currentImageIndex--;
      loadImage(state.currentCollectionIndex, state.currentImageIndex);
      domRefs.imageContainer.scrollLeft = 0;
      state.currentZoom = 1;
    }
  }

  // ===== UI UPDATES =====
  function updateProgressBar() {
    const container = domRefs.imageContainer;
    const max = container.scrollWidth - container.clientWidth;
    const progress = max > 0 ? (container.scrollLeft / max) * 100 : 100;
    domRefs.progressBar.style.width = progress + '%';
  }

  function showSwipeIndicator() {
    const indicator = domRefs.swipeIndicator;
    indicator.classList.remove('hidden');

    clearTimeout(state.scrollIndicatorTimeout);
    state.scrollIndicatorTimeout = setTimeout(() => {
      const container = domRefs.imageContainer;
      const max = container.scrollWidth - container.clientWidth;
      if (max > 0 && (container.scrollLeft / max) > 0.2) {
        indicator.classList.add('hidden');
      }
    }, 3000);
  }

  // ===== PUBLIC API EXPOSURE =====
  return {
    init,
    openFullscreen,
    closeFullscreen
  };
})();