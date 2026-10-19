/* ==========================================================
   Trailbound — Step 04: Climber details        (PASS 3, NEW FILE)
   ----------------------------------------------------------
   One card per person in the party. Name, age, sex, mobile and an
   emergency contact — the information a barangay or a rescue team
   needs and that a booking has never carried before.

   Until now a booking recorded group_size: 4. If four people went
   up and three came down, the only names anyone had were the
   payer's. This is what the "organised visitor information" line in
   the study is actually made of.

   WHY A SEPARATE FILE: booking.js is already 1,700 lines. Everything
   about these cards — building them, reading them back, validating
   them, resizing the list — lives here, and booking.js calls four
   functions. Nothing else on the booking page is touched.

   WHY NOT <label> + <input> INSIDE .form-group: booking.css styles
   `.form-group label` small/bold/UPPERCASE and `.form-group input`
   full-width/padded/bordered. That is exactly what made Step 03
   render as shouty empty boxes before it got its own stylesheet.
   These cards use their own class names and booking-pass3.css.

   A NOTE ON WHAT WE ASK FOR. This collects personal details about
   people who are NOT the account holder, so it asks for the least
   that still works in an emergency, the medical line is optional
   and free-text, and the step says plainly who sees it. Do not add
   a health questionnaire here.
   ========================================================== */

const LIST_ID = "climber-list";
const MAX_CLIMBERS = 15; // matches the group-size dropdown in booking.html

/** Mirrors the <select>, so a shrink knows what it is about to throw away. */
let lastCount = 0;

/* ---------- small helpers ---------- */

function listEl() {
  return document.getElementById(LIST_ID);
}

function cardEls() {
  const host = listEl();
  return host ? [...host.querySelectorAll(".climber-card")] : [];
}

function fieldIn(card, name) {
  return card.querySelector(`[data-field="${name}"]`);
}

function valueIn(card, name) {
  return (fieldIn(card, name)?.value || "").trim();
}

/** True when anything at all has been typed into this card. */
function cardHasData(card) {
  return ["name", "age", "sex", "phone", "emg_name", "emg_phone", "notes"].some(
    (f) => valueIn(card, f) !== "",
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/* ---------- building a card ---------- */

function cardHtml(index) {
  const n = index + 1;
  const who = n === 1 ? "Climber 1" : `Climber ${n}`;
  const lead = n === 1 ? '<span class="climber-lead-tag">Lead booker</span>' : "";
  const sameAsMe =
    n === 1
      ? '<button type="button" class="climber-same-btn" data-same-as-me>Same as me</button>'
      : "";

  return `
  <div class="climber-card" data-climber="${index}">
    <div class="climber-card-head">
      <span class="climber-card-number">${n}</span>
      <span class="climber-card-title">${escapeHtml(who)}</span>
      ${lead}
      ${sameAsMe}
    </div>

    <div class="climber-card-grid">
      <div class="climber-field climber-field--wide">
        <span class="climber-label climber-label--required">Full name</span>
        <input type="text" data-field="name" autocomplete="off"
               placeholder="Juan Dela Cruz" maxlength="80">
      </div>

      <div class="climber-field climber-field--age">
        <span class="climber-label climber-label--required">Age</span>
        <!-- DELIBERATELY type="text", not type="number" with min/max.
             booking.html's <form> has no novalidate, so the browser's
             own constraint validation runs on submit — and a field
             that fails it blocks the submit event entirely. The
             handler in booking.js never runs, so none of the
             per-card messages below ever appear and the person gets
             a native bubble instead. type="number" would also set
             badInput on a stray "e" or "+", with the same result.
             inputmode="numeric" still gives phones the number pad;
             the range is checked in validateClimbers(). -->
        <input type="text" data-field="age" inputmode="numeric"
               autocomplete="off" maxlength="3" placeholder="28">
      </div>

      <div class="climber-field climber-field--sex">
        <span class="climber-label climber-label--required">Sex</span>
        <!-- Age, Sex and Mobile share one row; the emergency contact's
             name and number share the next. Keeping that pair together
             matters — split across rows they read as two unrelated
             fields. -->

        <select data-field="sex">
          <option value="" selected>Select...</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Prefer not to say">Prefer not to say</option>
        </select>
      </div>

      <div class="climber-field climber-field--phone">
        <span class="climber-label">Mobile number</span>
        <input type="tel" data-field="phone" autocomplete="off"
               placeholder="0917 123 4567" maxlength="20">
      </div>

      <div class="climber-field">
        <span class="climber-label climber-label--required">Emergency contact</span>
        <input type="text" data-field="emg_name" autocomplete="off"
               placeholder="Maria Dela Cruz" maxlength="80">
      </div>

      <div class="climber-field">
        <span class="climber-label climber-label--required">Emergency number</span>
        <input type="tel" data-field="emg_phone" autocomplete="off"
               placeholder="0918 765 4321" maxlength="20">
      </div>

      <div class="climber-field climber-field--wide">
        <span class="climber-label">Anything rescue personnel should know? (optional)</span>
        <input type="text" data-field="notes" autocomplete="off"
               placeholder="e.g. asthma inhaler in my pack's left pocket" maxlength="160">
      </div>
    </div>

    <p class="climber-card-error" data-climber-error hidden></p>
  </div>`;
}

/* ---------- public: resizing the list ---------- */

/**
 * How many of the cards that a shrink to `next` would delete actually
 * have something typed in them. booking.js uses this to ask first.
 */
export function filledCardsBeyond(next) {
  return cardEls()
    .slice(Math.max(0, next))
    .filter(cardHasData).length;
}

/**
 * Grows or shrinks the card list to `next`. Cards that stay keep
 * whatever is typed in them — this rebuilds nothing it doesn't have to,
 * so changing the party from 2 to 3 never wipes climbers 1 and 2.
 */
export function syncClimberCards(next) {
  const host = listEl();
  if (!host) return;

  const target = Math.max(1, Math.min(MAX_CLIMBERS, Number(next) || 1));
  let cards = cardEls();

  while (cards.length > target) {
    cards.pop().remove();
  }
  while (cards.length < target) {
    host.insertAdjacentHTML("beforeend", cardHtml(cards.length));
    cards = cardEls();
  }

  lastCount = target;
  updateCountLabel(target);
}

function updateCountLabel(count) {
  const label = document.getElementById("climber-count");
  if (label) {
    label.textContent = count === 1 ? "1 climber" : `${count} climbers`;
  }
}

export function getLastCount() {
  return lastCount;
}

/* ---------- public: "Same as me" ---------- */

/**
 * Fills card 1 from the signed-in account. Only ever touches fields
 * that are still empty, so pressing it twice can't overwrite a
 * correction the person typed themselves.
 */
export function fillFirstFromUser(user) {
  const card = cardEls()[0];
  if (!card || !user) return;

  const name = (user.displayName || "").trim();
  if (name) {
    const input = fieldIn(card, "name");
    if (input && !input.value.trim()) input.value = name;
  }
}

/* ---------- public: reading them back ---------- */

/**
 * The array written onto the booking. Order matters: climber 1 is the
 * lead booker, which is who the admin and the guide will call first.
 */
export function readClimbers() {
  return cardEls().map((card, i) => ({
    seq: i + 1,
    name: valueIn(card, "name"),
    age: Number(valueIn(card, "age")) || null,
    sex: valueIn(card, "sex"),
    phone: valueIn(card, "phone"),
    emergency_name: valueIn(card, "emg_name"),
    emergency_phone: valueIn(card, "emg_phone"),
    notes: valueIn(card, "notes"),
  }));
}

/* ---------- public: validation ---------- */

const PHONE_OK = /^[0-9+().\-\s]{7,20}$/;

/**
 * Returns { ok, firstCard, message }. Marks the offending card so the
 * person can see which one of six is wrong, rather than being told
 * "please complete all fields" about a form two screens long.
 */
export function validateClimbers() {
  const cards = cardEls();

  cards.forEach((card) => {
    card.classList.remove("climber-card--invalid");
    const err = card.querySelector("[data-climber-error]");
    if (err) err.hidden = true;
  });

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const who = `Climber ${i + 1}`;

    const name = valueIn(card, "name");
    const ageRaw = valueIn(card, "age");
    const age = Number(ageRaw);
    const sex = valueIn(card, "sex");
    const emgName = valueIn(card, "emg_name");
    const emgPhone = valueIn(card, "emg_phone");
    const ownPhone = valueIn(card, "phone");

    let problem = null;

    if (!name) problem = "Enter this climber's full name.";
    else if (name.length < 2) problem = "That name looks too short.";
    else if (!ageRaw) problem = "Enter this climber's age.";
    // Whole numbers only. `Number("3.5")` is finite and `Number("")`
    // is 0, so neither test alone is enough on a text field.
    else if (!/^\d{1,3}$/.test(ageRaw) || !Number.isFinite(age) || age < 1 || age > 100)
      problem = "Enter an age between 1 and 100.";
    else if (!sex) problem = "Choose an option for sex.";
    else if (!emgName) problem = "Enter an emergency contact name.";
    else if (!emgPhone) problem = "Enter an emergency contact number.";
    else if (!PHONE_OK.test(emgPhone))
      problem = "That emergency number doesn't look like a phone number.";
    else if (ownPhone && !PHONE_OK.test(ownPhone))
      problem = "That mobile number doesn't look like a phone number.";
    // An emergency contact who is the climber is no use at all.
    else if (ownPhone && digits(ownPhone) && digits(ownPhone) === digits(emgPhone))
      problem = "The emergency number can't be this climber's own number.";

    if (problem) {
      card.classList.add("climber-card--invalid");
      const err = card.querySelector("[data-climber-error]");
      if (err) {
        err.textContent = problem;
        err.hidden = false;
      }
      return { ok: false, card, message: `${who}: ${problem}` };
    }
  }

  return { ok: true, card: null, message: "" };
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

/* ---------- public: reset after a successful booking ---------- */

export function resetClimbers() {
  const host = listEl();
  if (host) host.innerHTML = "";
  lastCount = 0;
  syncClimberCards(1);
}

/* ---------- wiring the one delegated listener ---------- */

/**
 * Called once by booking.js. `onSameAsMe` is handed the card so the
 * caller can decide where "me" comes from — this module deliberately
 * knows nothing about Firebase.
 */
export function initClimbers({ onSameAsMe } = {}) {
  const host = listEl();
  if (!host) return;

  host.addEventListener("click", (event) => {
    if (event.target.closest("[data-same-as-me]")) {
      event.preventDefault();
      onSameAsMe?.();
    }
  });

  // Typing in a card clears its error — the same behaviour the
  // checkout dialogs already have.
  host.addEventListener("input", (event) => {
    const card = event.target.closest(".climber-card");
    if (!card) return;
    card.classList.remove("climber-card--invalid");
    const err = card.querySelector("[data-climber-error]");
    if (err) err.hidden = true;
  });

  syncClimberCards(1);
}
