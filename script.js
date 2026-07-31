import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { Flip } from "gsap/Flip";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText, Flip);

const lenis = new Lenis();

lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
});
gsap.ticker.lagSmoothing(0);

/* ==========================================================
   HERO (Trailbound)
   ========================================================== */

const outroHeaderSplit = SplitText.create(".hero-outro-header h3", {
  type: "lines",
  mask: "lines",
  linesClass: "line",
});
gsap.set(outroHeaderSplit.lines, { y: "100%" });

const fgContent = document.querySelector(".hero-fg-content");
const fgOverlayDark = document.querySelector(".hero-fg-overlay-dark");
const fgOverlayAccent = document.querySelector(".hero-fg-overlay");
const bgCopyLeft = document.querySelectorAll(".hero-bg-content-copy")[0];
const bgCopyRight = document.querySelectorAll(".hero-bg-content-copy")[1];
const outroImgTop = document.querySelectorAll(".hero-outro-img")[0];
const outroImgBottom = document.querySelectorAll(".hero-outro-img")[1];

let areOutroLinesRevealed = false;

// Cinematic entrance animation (plays once on load)
const heroVideo = document.querySelector(".hero-fg-img video");
const heroHeadline = document.querySelector(".hero-fg-header h1");

const introTl = gsap.timeline({ defaults: { ease: "power2.out" } });

introTl
  .to(
    heroVideo,
    {
      scale: 1.05,
      duration: 6,
      ease: "none",
    },
    0,
  )
  .to(
    heroHeadline,
    {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "power2.out",
    },
    0.2,
  );

ScrollTrigger.create({
  trigger: ".hero",
  start: "top top",
  end: `+=${window.innerHeight * 5}px`,
  pin: true,
  pinSpacing: true,
  scrub: 1,
  onUpdate: (self) => {
    const scrollProgress = self.progress;

    const phase1Progress = gsap.utils.clamp(0, 1, scrollProgress / 0.25);
    const slitLeftEdge = gsap.utils.interpolate(0, 48, phase1Progress);
    const slitRightEdge = gsap.utils.interpolate(100, 52, phase1Progress);

    gsap.set(fgContent, {
      clipPath: `polygon(${slitLeftEdge}% 0%, ${slitRightEdge}% 0%, ${slitRightEdge}% 100%, ${slitLeftEdge}% 100%)`,
    });

    const darkOverlayOpacity = gsap.utils.interpolate(0, 1, phase1Progress);
    gsap.set(fgOverlayDark, { opacity: darkOverlayOpacity });

    const phase2Progress = gsap.utils.clamp(
      0,
      1,
      (scrollProgress - 0.25) / 0.2,
    );
    const fgRotation = gsap.utils.interpolate(0, 65, phase2Progress);
    gsap.set(fgContent, { rotate: fgRotation });

    const phase3Progress = gsap.utils.clamp(
      0,
      1,
      (scrollProgress - 0.45) / 0.2,
    );
    const fgScale = gsap.utils.interpolate(1, 0, phase3Progress);
    gsap.set(fgContent, { scale: fgScale });

    const bgCopyLeftX = gsap.utils.interpolate(0, 100, phase3Progress);
    const bgCopyRightX = gsap.utils.interpolate(0, -100, phase3Progress);
    gsap.set(bgCopyLeft, { x: `${bgCopyLeftX}%` });
    gsap.set(bgCopyRight, { x: `${bgCopyRightX}%` });

    const phase3OverlayProgress = gsap.utils.clamp(
      0,
      1,
      (scrollProgress - 0.45) / 0.05,
    );
    const redOverlayOpacity = gsap.utils.interpolate(
      0,
      1,
      phase3OverlayProgress,
    );
    gsap.set(fgOverlayAccent, { opacity: redOverlayOpacity });

    const phase4Progress = gsap.utils.clamp(
      0,
      1,
      (scrollProgress - 0.65) / 0.2,
    );

    const topImgBottomEdge = gsap.utils.interpolate(0, 100, phase4Progress);
    gsap.set(outroImgTop, {
      clipPath: `polygon(0% 0%, 100% 0%, 100% ${topImgBottomEdge}%, 0% ${topImgBottomEdge}%)`,
    });

    const bottomImgTopEdge = gsap.utils.interpolate(100, 0, phase4Progress);
    gsap.set(outroImgBottom, {
      clipPath: `polygon(0% ${bottomImgTopEdge}%, 100% ${bottomImgTopEdge}%, 100% 100%, 0% 100%)`,
    });

    if (scrollProgress >= 0.9 && !areOutroLinesRevealed) {
      areOutroLinesRevealed = true;
      gsap.to(outroHeaderSplit.lines, {
        y: "0%",
        duration: 0.75,
        stagger: 0.1,
        ease: "power3.out",
      });
    } else if (scrollProgress < 0.9 && areOutroLinesRevealed) {
      areOutroLinesRevealed = false;
      gsap.to(outroHeaderSplit.lines, {
        y: "100%",
        duration: 0.25,
        stagger: -0.05,
        ease: "power3.out",
      });
    }
  },
});

// Header hide/show on scroll
const siteHeader = document.querySelector(".site-header");
let lastScrollY = 0;
let scrollStopTimeout;

lenis.on("scroll", (e) => {
  const currentScrollY = e.scroll;

  if (currentScrollY > lastScrollY && currentScrollY > 100) {
    siteHeader.classList.add("hide");
  } else {
    siteHeader.classList.remove("hide");
  }

  lastScrollY = currentScrollY;

  clearTimeout(scrollStopTimeout);
  scrollStopTimeout = setTimeout(() => {
    siteHeader.classList.remove("hide");
  }, 150);
});

/* ==========================================================
   SLIDER (GlitchAndGrit) — driven by wheel/touch, not real scroll
   ========================================================== */

const settings = {
  scrollSensitivity: 1200,
  smoothness: 0.05,
  bufferSlides: 3,
  imageShift: 25,
  copyShift: 15,
  titleHold: 0.1,
  imageZoom: 1.25,
  revealOverlap: 0.5,
};

const slides = [
  {
    title: "Studioform",
    tags: ["Studio & Movement", "Fitness & Method", "Space & Design"],
    accent: "#a9d0f5",
    link: "/studioform/",
  },
  {
    title: "Nightbloom",
    tags: ["Editorial & Portrait", "Concept & Series", "Art & Direction"],
    accent: "#f5a97a",
    link: "/nightbloom/",
  },
  {
    title: "Stillpose",
    tags: ["Movement & Wellness", "Body & Practice", "Brand & Identity"],
    accent: "#b7e0a0",
    link: "/stillpose/",
  },
  {
    title: "Blurface",
    tags: ["Fashion & Portrait", "Motion & Study", "Brand & Identity"],
    accent: "#e8e8e8",
    link: "/blurface/",
  },
];

const columns = {
  left: { el: document.querySelector(".left"), visibleSlides: new Map() },
  right: { el: document.querySelector(".right"), visibleSlides: new Map() },
};

let scrollPosition = 1;
let scrollTarget = 1;
let lastTouchY = 0;

function createSlide(side, index) {
  const slideIndex = ((index % slides.length) + slides.length) % slides.length;
  const data = slides[slideIndex];

  const el = document.createElement("div");
  el.className = "slide";
  el.style.zIndex = index;
  el.innerHTML = `
    <img src="/assets/slide_img_${side}_${slideIndex + 1}.jpg" alt="" />
    <div class="overlay"></div>
    <div class="copy" style="color:${data.accent}">
      <div class="slide-tags">${data.tags.join("<br />")}</div>
      <div class="slide-title">${data.title}</div>
      <a href="${data.link}" class="slide-link">View Full Project</a>
    </div>
  `;

  columns[side].el.appendChild(el);
  columns[side].visibleSlides.set(index, el);
}

function getRevealShape(side, revealAmount) {
  const d =
    Math.max(0, Math.min(1, revealAmount)) * (100 + settings.revealOverlap);
  return side === "left"
    ? `polygon(0% ${100 - d}%, 100% ${100 - d}%, 100% 100%, 0% 100%)`
    : `polygon(0% 0%, 100% 0%, 100% ${d}%, 0% ${d}%)`;
}

function getTitlePosition(slideProgress) {
  const fromCenter = slideProgress - 1;
  const past = Math.abs(fromCenter) - settings.titleHold;
  if (past <= 0) return 1;
  const t = past / (1 - settings.titleHold);
  return 1 + Math.sign(fromCenter) * t * t * (3 - 2 * t);
}

function updateSlider() {
  const first = Math.floor(scrollPosition) - settings.bufferSlides;
  const last = Math.floor(scrollPosition) + settings.bufferSlides + 1;

  for (const side of ["left", "right"]) {
    const visibleSlides = columns[side].visibleSlides;
    const driftDirection = side === "left" ? 1 : -1;

    for (let i = first; i <= last; i++) {
      if (!visibleSlides.has(i)) createSlide(side, i);
    }

    for (const [index, el] of visibleSlides) {
      if (index < first || index > last) {
        el.remove();
        visibleSlides.delete(index);
        continue;
      }

      const revealAmount = scrollPosition - index;
      const slideProgress = Math.max(0, Math.min(2, revealAmount));

      el.style.clipPath = getRevealShape(side, revealAmount);

      const imageDrift =
        (1 - slideProgress) * settings.imageShift * driftDirection;
      el.querySelector("img").style.transform =
        `translateY(${imageDrift}%) scale(${settings.imageZoom})`;

      const titleDrift =
        (1 - getTitlePosition(slideProgress)) *
        settings.copyShift *
        driftDirection;
      el.querySelector(".copy").style.transform = `translateY(${titleDrift}%)`;
    }
  }
}

// scrollTarget is now driven by real page scroll (see the ScrollTrigger
// handoff below), not raw wheel/touch deltas. This keeps it reversible —
// scrolling back up moves scrollTarget back down automatically, same as
// Lenis/ScrollTrigger already do for the hero section.

function animateSlider() {
  scrollPosition += (scrollTarget - scrollPosition) * settings.smoothness;
  updateSlider();
  requestAnimationFrame(animateSlider);
}

animateSlider();

/* ==========================================================
   HANDOFF: about -> slider
   ========================================================== */

const sliderWrap = document.querySelector(".slider-wrap");

// "3 scrolls" worth of pin distance — leaves room to add another
// section right after this one later.
const SLIDER_SCROLL_LENGTH = window.innerHeight * 3;
// How many virtual slide-steps to move through across that distance.
// Bump this up if you want more slides to cycle by per scroll length.
const SLIDER_TARGET_RANGE = 6;

ScrollTrigger.create({
  trigger: ".slider-section",
  start: "top top",
  end: `+=${SLIDER_SCROLL_LENGTH}px`,
  pin: true,
  pinSpacing: true,
  scrub: 1,
  onUpdate: (self) => {
    const progress = self.progress;

    // Drive the slider's own scrollTarget from real scroll progress
    // instead of wheel deltas — this is what makes it reversible.
    scrollTarget = 1 + progress * SLIDER_TARGET_RANGE;

    // Fade the slider in over the first 15% of this section's scroll,
    // and back out over the last 15% so the next section (WonJYou) is
    // visible once this section's pin releases. Without the fade-out,
    // .slider-wrap (position: fixed) would stay stuck on top of
    // everything below it forever.
    let fadeProgress;
    if (progress < 0.15) {
      fadeProgress = progress / 0.15;
    } else if (progress > 0.85) {
      fadeProgress = 1 - (progress - 0.85) / 0.15;
    } else {
      fadeProgress = 1;
    }
    gsap.set(sliderWrap, { opacity: fadeProgress });
    sliderWrap.classList.toggle("active", fadeProgress > 0.5);
  },
});

/* ==========================================================
   WONJYOU — marquee + pinned image flip + horizontal scroll
   ========================================================== */

const wonjyouLightColor = getComputedStyle(document.documentElement)
  .getPropertyValue("--light")
  .trim();
const wonjyouDarkColor = getComputedStyle(document.documentElement)
  .getPropertyValue("--dark")
  .trim();

function interpolateColor(color1, color2, factor) {
  return gsap.utils.interpolate(color1, color2, factor);
}

// ── Marquee horizontal drift on scroll ──────────────────────────────────
gsap.to(".marquee-images", {
  scrollTrigger: {
    trigger: ".marquee",
    start: "top bottom",
    end: "top top",
    scrub: true,
    onUpdate: (self) => {
      const progress = self.progress;
      const xPosition = -75 + progress * 25;
      gsap.set(".marquee-images", {
        x: `${xPosition}%`,
      });
    },
  },
});

// ── Pinned marquee image clone helpers ──────────────────────────────────
let pinnedMarqueeImgClone = null;
let isImgCloneActive = false;

function createPinnedMarqueeImgClone() {
  if (isImgCloneActive) return;

  const originalMarqueeImg = document.querySelector(".marquee-img.pin img");
  const rect = originalMarqueeImg.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  pinnedMarqueeImgClone = originalMarqueeImg.cloneNode(true);

  gsap.set(pinnedMarqueeImgClone, {
    position: "fixed",
    left: centerX - originalMarqueeImg.offsetWidth / 2 + "px",
    top: centerY - originalMarqueeImg.offsetHeight / 2 + "px",
    width: originalMarqueeImg.offsetWidth + "px",
    height: originalMarqueeImg.offsetHeight + "px",
    transform: "rotate(-5deg)",
    transformOrigin: "center center",
    pointerEvents: "none",
    willChange: "transform",
    zIndex: 100,
  });

  document.body.appendChild(pinnedMarqueeImgClone);
  gsap.set(originalMarqueeImg, { opacity: 0 });
  isImgCloneActive = true;
}

function removePinnedMarqueeImgClone() {
  if (!isImgCloneActive) return;
  if (pinnedMarqueeImgClone) {
    pinnedMarqueeImgClone.remove();
    pinnedMarqueeImgClone = null;
  }
  const originalMarqueeImg = document.querySelector(".marquee-img.pin img");
  gsap.set(originalMarqueeImg, { opacity: 1 });
  isImgCloneActive = false;
}

// ── Pin the entire horizontal scroll section ────────────────────────────
ScrollTrigger.create({
  trigger: ".horizontal-scroll",
  start: "top top",
  end: () => `+=${window.innerHeight * 5}`,
  pin: true,
});

// ── Activate / deactivate the cloned image on marquee enter/leave ───────
ScrollTrigger.create({
  trigger: ".marquee",
  start: "top top",
  onEnter: createPinnedMarqueeImgClone,
  onEnterBack: createPinnedMarqueeImgClone,
  onLeaveBack: removePinnedMarqueeImgClone,
});

// ── Flip animation: clone expands to full-screen on enter ───────────────
let flipAnimation = null;

ScrollTrigger.create({
  trigger: ".horizontal-scroll",
  start: "top 50%",
  end: () => `+=${window.innerHeight * 5.5}`,
  onEnter: () => {
    if (pinnedMarqueeImgClone && isImgCloneActive && !flipAnimation) {
      const state = Flip.getState(pinnedMarqueeImgClone);

      gsap.set(pinnedMarqueeImgClone, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: "100%",
        height: "100svh",
        transform: "rotate(0deg)",
        transformOrigin: "center center",
      });

      flipAnimation = Flip.from(state, {
        duration: 1,
        ease: "none",
        paused: true,
      });
    }
  },
  onLeaveBack: () => {
    if (flipAnimation) {
      flipAnimation.kill();
      flipAnimation = null;
    }
    gsap.set(".wonjyou", {
      backgroundColor: wonjyouLightColor,
    });
    gsap.set(".horizontal-scroll-wrapper", {
      x: "0%",
    });
  },
});

// ── Main progress driver: colour, flip, horizontal scroll, image ─────────
ScrollTrigger.create({
  trigger: ".horizontal-scroll",
  start: "top 50%",
  end: () => `+=${window.innerHeight * 5.5}`,
  onUpdate: (self) => {
    const progress = self.progress;

    // Background colour transition (0 → 0.05)
    if (progress <= 0.05) {
      const bgColorProgress = Math.min(progress / 0.05, 1);
      const newBgColor = interpolateColor(
        wonjyouLightColor,
        wonjyouDarkColor,
        bgColorProgress,
      );
      gsap.set(".wonjyou", {
        backgroundColor: newBgColor,
      });
    } else if (progress > 0.05) {
      gsap.set(".wonjyou", {
        backgroundColor: wonjyouDarkColor,
      });
    }

    // Drive flip animation progress (0 → 0.2)
    if (progress <= 0.2) {
      const scaleProgress = progress / 0.2;
      if (flipAnimation) {
        flipAnimation.progress(scaleProgress);
      }
    }

    // Horizontal scroll movement (0.2 → 0.95)
    if (progress > 0.2 && progress <= 0.95) {
      if (flipAnimation) {
        flipAnimation.progress(1);
      }

      const horizontalProgress = (progress - 0.2) / 0.75;

      const wrapperTranslateX = -66.67 * horizontalProgress;
      gsap.set(".horizontal-scroll-wrapper", {
        x: `${wrapperTranslateX}%`,
      });

      const slideMovement = (66.67 / 100) * 3 * horizontalProgress;
      const imageTranslateX = -slideMovement * 100;
      gsap.set(pinnedMarqueeImgClone, {
        x: `${imageTranslateX}%`,
      });
    } else if (progress > 0.95) {
      // Snap to final resting position
      if (flipAnimation) {
        flipAnimation.progress(1);
      }
      gsap.set(pinnedMarqueeImgClone, {
        x: "-200%",
      });
      gsap.set(".horizontal-scroll-wrapper", {
        x: "-66.67%",
      });
    }
  },
});