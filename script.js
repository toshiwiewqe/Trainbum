import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

const lenis = new Lenis();

lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
});
gsap.ticker.lagSmoothing(0);

/* ==========================================================
   FRAME SEQUENCE HERO — the homepage

   Progress comes from ScrollTrigger — which Lenis already drives
   and `scrub` already eases — so there is no private scroll
   listener and no rAF loop here. It just paints the right frame
   when ScrollTrigger reports a change.

   Frames live in public/frames/ and are served from /frames/.

   This file is loaded on every page for Lenis + the header
   behaviour at the bottom; initHeroFrames() returns early on
   pages with no .framescene, so nothing here breaks trail.html,
   products.html, etc.
   ========================================================== */

/* ---------- config ---------- */
const FRAMES = {
  dir: "/frames/",
  prefix: "ezgif-frame-",
  ext: ".jpg",
  pad: 3,
  from: 1,
  count: 241,
};

// How much scroll the frame sequence occupies. 5 viewport heights
// over 241 frames is roughly 18px of scroll per frame — raise it for
// a slower, more cinematic scrub, lower it to get through the scene
// faster.
const SCENE_SCROLL = () => window.innerHeight * 5;

// Appended to SCENE_SCROLL: the distance over which the hero lifts
// away and uncovers the contact block. One viewport height.
const LIFT_SCROLL = () => window.innerHeight;
const TOTAL_SCROLL = () => SCENE_SCROLL() + LIFT_SCROLL();

// Where the lift begins, inside the timeline of the whole pin.
const CLIP_START = 0.35; // edges hold still, then close in
const CLIP_SPAN = 0.65;
const CH_START = 0.45; // phone number starts wiping in
const CH_SPAN = 0.28;
const CH_STAGGER = 0.01;

const STRIDES = [12, 4, 1]; // load every 12th, then every 4th, then the rest
const REVEAL_PASS = 2; // drop the loading veil after this many passes
const CONCURRENCY = 8; // parallel image requests
const WARM_AHEAD = 30; // frames decoded ahead of the playhead
const WARM_BEHIND = 10;
const DPR_CAP = 2;

const N = FRAMES.count;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const noop = () => {};

function initHeroFrames() {
  const scene = document.querySelector(".framescene");
  const canvas = document.getElementById("frame-canvas");
  if (!scene || !canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const veil = document.getElementById("frame-veil");
  const veilFill = document.getElementById("frame-veil-fill");
  const panels = [
    document.querySelector('[data-panel="1"]'),
    document.querySelector('[data-panel="2"]'),
    document.querySelector('[data-panel="3"]'),
  ];

  /* ---------- frame bank ---------- */
  const imgs = new Array(N);
  const ready = new Uint8Array(N);
  const warmed = new Uint8Array(N);
  let loaded = 0;
  let drawn = -1;
  let want = 0;
  let warmedFor = -1;
  let srcW = 0;
  let srcH = 0;
  let live = false;

  const pad = (n, w) => String(n).padStart(w, "0");
  const srcOf = (i) =>
    FRAMES.dir + FRAMES.prefix + pad(FRAMES.from + i, FRAMES.pad) + FRAMES.ext;

  // Sparse-first order so coarse scrubbing works before everything lands.
  let revealAt = N;
  const order = (() => {
    const seen = new Uint8Array(N);
    const out = [];
    STRIDES.forEach((stride, pass) => {
      for (let i = 0; i < N; i += stride) {
        if (!seen[i]) {
          seen[i] = 1;
          out.push(i);
        }
      }
      if (pass === REVEAL_PASS - 1) revealAt = out.length;
    });
    for (let i = 0; i < N; i++) {
      if (!seen[i]) {
        seen[i] = 1;
        out.push(i);
      }
    }
    return out;
  })();

  function nearestReady(i) {
    if (ready[i]) return i;
    for (let d = 1; d < N; d++) {
      if (i - d >= 0 && ready[i - d]) return i - d;
      if (i + d < N && ready[i + d]) return i + d;
    }
    return -1;
  }

  /* ---------- canvas ---------- */
  function sizeCanvas() {
    const cssW = scene.clientWidth;
    const cssH = scene.clientHeight;
    if (!cssW || !cssH) return;

    let dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    // Never allocate more pixels than a 1920x1080 source can actually fill.
    if (srcW) dpr = Math.min(dpr, Math.max(1, Math.max(srcW / cssW, srcH / cssH)));

    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      drawn = -1; // backing store reset — force a repaint
    }
  }

  function paint(i) {
    const img = imgs[i];
    if (!img) return;
    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || srcW;
    const ih = img.naturalHeight || srcH;
    if (!iw || !ih) return;

    // cover fit
    const s = Math.max(cw / iw, ch / ih);
    ctx.drawImage(img, (cw - iw * s) * 0.5, (ch - ih * s) * 0.5, iw * s, ih * s);

    if (!live) {
      live = true;
      canvas.classList.add("is-live");
    }
  }

  function render() {
    const best = nearestReady(want);
    if (best >= 0 && best !== drawn) {
      paint(best);
      drawn = best;
    }
  }

  // Decode a window around the playhead so drawImage never blocks.
  function warmWindow(i, dir) {
    const lo = clamp(i - (dir < 0 ? WARM_AHEAD : WARM_BEHIND), 0, N - 1);
    const hi = clamp(i + (dir < 0 ? WARM_BEHIND : WARM_AHEAD), 0, N - 1);
    for (let k = lo; k <= hi; k++) {
      if (ready[k] && !warmed[k]) {
        warmed[k] = 1;
        imgs[k].decode?.().catch(noop);
      }
    }
  }

  /* ---------- loading ---------- */
  let cursor = 0;
  let active = 0;

  function onLoadProgress() {
    if (veilFill) veilFill.style.transform = `scaleX(${loaded / N})`;
    if (veil && !veil.classList.contains("is-done") && ready[0] && loaded >= revealAt) {
      veil.classList.add("is-done");
    }
  }

  function pump() {
    while (active < CONCURRENCY && cursor < order.length) load(order[cursor++]);
  }

  function load(i) {
    active++;
    const img = new Image();
    img.decoding = "async";
    if ("fetchPriority" in img && cursor <= 8) img.fetchPriority = "high";

    img.onload = () => {
      ready[i] = 1;
      loaded++;
      active--;
      if (!srcW && img.naturalWidth) {
        srcW = img.naturalWidth;
        srcH = img.naturalHeight;
        sizeCanvas();
      }
      onLoadProgress();
      render(); // a better frame may now be available for the current position
      pump();
    };
    img.onerror = () => {
      active--;
      loaded++;
      onLoadProgress();
      pump();
    };

    imgs[i] = img;
    img.src = srcOf(i);
  }

  /* ---------- overlay panels ---------- */
  const p1 = (p) => (p < 0.2 ? 1 : Math.max(0, 1 - (p - 0.2) / 0.08));
  const p2 = (p) => {
    if (p < 0.32) return 0;
    if (p < 0.4) return (p - 0.32) / 0.08;
    if (p < 0.55) return 1;
    return Math.max(0, 1 - (p - 0.55) / 0.08);
  };
  const p3 = (p) => {
    if (p < 0.67) return 0;
    if (p < 0.75) return (p - 0.67) / 0.08;
    return 1;
  };

  const lastOpacity = [-1, -1, -1];

  function paintPanels(p) {
    const values = [p1(p), p2(p), p3(p)];
    for (let i = 0; i < 3; i++) {
      if (!panels[i]) continue;
      if (Math.abs(values[i] - lastOpacity[i]) > 0.001) {
        panels[i].style.opacity = values[i];
        panels[i].classList.toggle("is-visible", values[i] > 0.3);
        // Panel three holds the "Find your trail" link, which turns
        // pointer events back on for itself. Without this, that link
        // stays clickable while the panel is still invisible earlier
        // in the scrub, so a stray click navigates away mid-scene.
        panels[i].style.pointerEvents = values[i] > 0.3 ? "" : "none";
        lastOpacity[i] = values[i];
      }
    }
  }

  /* ---------- hero lift ----------
     Runs across the last LIFT_SCROLL of the pin. Painted by hand
     from progress, same as paintPanels above — no GSAP timeline,
     because the timeline positions would have to be rebuilt on
     every resize to track the scene/lift split. */

  const lift = document.getElementById("framescene-lift");
  const chars = [];

  const splitLine = () => {
    const target = scene.querySelector("[data-fs-split]");
    if (!target) return;
    const text = target.textContent;
    // aria-label first, so the accessible name survives the split —
    // a screen reader shouldn't have to reassemble 18 spans.
    target.setAttribute("aria-label", text);
    target.textContent = "";
    for (const c of text) {
      const box = document.createElement("span");
      box.className = "fs-ch";
      const glyph = document.createElement("i");
      glyph.textContent = c === " " ? "\u00A0" : c;
      box.appendChild(glyph);
      target.appendChild(box);
      chars.push(glyph);
    }
  };
  splitLine();

  // Read from CSS every paint so the media query override is picked
  // up on a resize across the md breakpoint without a refresh hook.
  const dials = () => {
    const cs = getComputedStyle(scene);
    return {
      clip: parseFloat(cs.getPropertyValue("--fs-clip-end")) || 0,
      lift: parseFloat(cs.getPropertyValue("--fs-lift-end")) || 0,
    };
  };

  let lastLift = -1;

  function paintLift(q) {
    if (!lift || Math.abs(q - lastLift) < 0.0005) return;
    lastLift = q;

    const d = dials();

    lift.style.transform = `translate3d(0, ${d.lift * q}%, 0)`;

    const c = d.clip * clamp((q - CLIP_START) / CLIP_SPAN, 0, 1);
    lift.style.clipPath = `inset(0% ${c}% 0% ${c}%)`;

    for (let i = 0; i < chars.length; i++) {
      const t = clamp((q - CH_START - i * CH_STAGGER) / CH_SPAN, 0, 1);
      const e = 1 - (1 - t) * (1 - t); // power2.out
      chars[i].style.transform = `translateY(${(1 - e) * 110}%)`;
      chars[i].style.opacity = e;
    }
  }

  /* ---------- wire it up ---------- */
  sizeCanvas();
  pump();
  paintPanels(0);
  paintLift(0);

  ScrollTrigger.create({
    trigger: ".framescene",
    start: "top top",
    end: () => `+=${TOTAL_SCROLL()}`,
    pin: true,
    pinSpacing: true,
    scrub: 1, // ScrollTrigger + Lenis already ease this — no extra lerp needed
    invalidateOnRefresh: true,
    onRefresh: sizeCanvas,
    onUpdate: (self) => {
      // One trigger, two phases. The split is recomputed per frame
      // rather than cached, so it survives a resize mid-scroll.
      const split = SCENE_SCROLL() / TOTAL_SCROLL();
      const p = clamp(self.progress / split, 0, 1);
      const q = clamp((self.progress - split) / (1 - split), 0, 1);

      paintPanels(p);
      paintLift(q);

      const idx = clamp(Math.round(p * (N - 1)), 0, N - 1);
      if (idx !== want) {
        warmWindow(idx, warmedFor < 0 ? 1 : idx - warmedFor);
        warmedFor = idx;
        want = idx;
      }
      render();
    },
  });

  window.addEventListener("resize", sizeCanvas);
}

// Pins .framescene for innerHeight * 6 and drives the whole scene,
// hero lift included. No-ops on pages without the hero.
initHeroFrames();

// Header hide/show on scroll
const siteHeader = document.querySelector(".site-header");
let lastScrollY = 0;
let scrollStopTimeout;

lenis.on("scroll", (e) => {
  if (!siteHeader) return;

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