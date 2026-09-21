# Trailbound — Sync Setup

**This replaces every earlier note I sent.** Ignore `INTEGRATION.md`,
`ROUND-3-NOTES.md` and `FILES.md` — they're gone from this bundle.

33 files. **Nothing needs hand-editing.** Every file here is complete: copy them
into your project root, overwriting what's there, and follow §3.

---

## 1. What you're building

One shared module, `trailbound-data.js`, that both halves of the app import.
Every read is a live Firestore listener (`onSnapshot`), so nothing polls and
nothing needs refreshing.

```
   ADMIN                      trailbound-data.js                   CUSTOMER
   ─────                      ──────────────────                   ────────
   Catalog      ──┐         ┌──────────────────┐         ┌──  trail.html
   Gear         ──┤         │                  │         ├──  products.html
   Bookings     ──┼────────▶│    Firestore     │◀────────┼──  booking.html
   Orders       ──┤         │   (live streams) │         ├──  checkout.html
   Users        ──┤         │                  │         ├──  account.html
   Support      ──┤         └──────────────────┘         └──  index.html
   Settings     ──┘                                          
```

**The six sync paths, once this is in:**

| An admin does this | The customer sees |
|---|---|
| Adds a trail in Catalog | It appears on trail.html and in booking.html's dropdown |
| Sets a trail to Closed | It disappears from both |
| Sets a guide to Inactive | It stops being offered on their trails |
| Disables gear in Gear | It vanishes from products.html |
| Confirms a booking | Their booking status flips **and** their bell badge ticks up |
| Marks an order Paid | The trail bookings on it are confirmed automatically |
| Saves Settings | The public site name updates, no redeploy |

| A customer does this | The admin sees |
|---|---|
| Completes a booking | It appears in Bookings + the dashboard chart and activity feed |
| Reaches Maya checkout | The order appears in Orders |
| Signs up | They appear in Users immediately |
| Sends a contact message | It appears in Support |

---

## 2. Before you start — three things that are broken right now

Worth understanding, because they explain symptoms you may already have seen.

**Your admin panel has never been deployed.** `vite.config.js` lists nine entry
points and not one is an admin page. Vite only builds HTML in
`rollupOptions.input`; everything else never reaches `dist/`, which is what
Firebase serves. The panel works under `npm run dev` and 404s in production.

**`payment-result.html` was missing from that list too.** Maya redirects there
after every payment. In production that redirect has been hitting a 404 — so
**no order has ever been marked Paid and no booking has ever reached
Confirmed.** Check your `orders` collection after deploying; they're probably all
still "Pending Payment".

**Nothing in admin managed trails, guides or packages.** Those three collections
are what `booking.js` builds its dropdowns from. The only way to add a trail was
by hand in the Firebase console. That's the new Catalog page.

---

## 3. Do this, in order

### Step 1 — Back up
```bash
git add -A && git commit -m "before sync work"
```
Everything below overwrites files. Be able to undo it.

### Step 2 — Copy the files in
Drop all 33 into your project root, overwriting. They're all complete files, not
fragments.

### Step 3 — Deploy the rules FIRST
```bash
firebase deploy --only firestore:rules
```
Before the code, not after. The customer-side queries are written to satisfy
these rules — Firestore rejects any query that *could* return a document the
rules forbid, so the old code would fail against the new rules and vice versa.

### Step 4 — Make yourself an admin (if you haven't)
1. Sign in once at `login.html` so a Firebase Auth account exists.
2. Firebase console → Authentication → Users → copy your UID.
3. Firestore → collection `admins` → document ID = your UID → add `role: "admin"`.

This stays a console action on purpose. The rules block *all* client writes to
`admins`, so admin access can never be granted from a browser.

### Step 5 — Build and deploy
```bash
npm run build
firebase deploy --only hosting
```

### Step 6 — Open `/admin-login.html` on the live site
For the first time. Sign in.

### Step 7 — Fill the catalog
Admin → Catalog. **Guides tab first**, then Trails (you assign guides to a trail,
so they must exist), then Packages.

Watch the **Bookable Now** tile. A trail only works if at least one guide
assigned to it is Active — otherwise the guide dropdown on the booking page comes
up empty and the customer cannot finish a booking. The page warns you when that's
true of every trail.

### Step 8 — Test the loop end to end
1. Admin → Catalog → add a trail → open `trail.html` in another tab. It's there.
2. Set it Closed → the card greys out without you refreshing.
3. Book it as a customer → it appears in Admin → Bookings.
4. Confirm it in admin → the customer's account page updates live.
5. Admin → Gear → disable a product → it leaves `products.html`.

If all five work, you're done.

---

## 4. The data model

Twelve collections. **Bold** = an admin screen manages it.

| Collection | Holds | Read by |
|---|---|---|
| **`trails`** | trail_id, name, location, difficulty, duration, image, base_price, guide_id[], status | trail.js, booking.js |
| **`guides`** | guide_id, full_name, specialty, rating, status | booking.js |
| **`packages`** | package_id, name, price_per_pax, includes[], requires_activity_choice | booking.js |
| **`products`** | name, category, price, status, images[], attributes | products.js |
| **`bookings`** | uid, trail_id, package_id, guide_id, date, group_size, total_price, status, payment_status | admin, account.js |
| **`orders`** | uid, items[], booking_ids[], contact, shipping, payment, total, status | admin, payment-result.js |
| **`contact`** | name, email, subject, message, status | admin Support |
| **`users`** | displayName, email, phone, role, addresses, lastActiveAt | admin Users, account.js |
| `users/{uid}/notifications` | title, message, read, createdAt | account.js bell |
| `users/{uid}/wishlist` | productId, name, image, price | account.js |
| **`settings/site`** | siteName, timezone, notifications | every public page |
| `activity` | userName, activity, amount, status | admin dashboard |
| `product_reviews` | productId, name, rating, comment | products.js |
| `admins/{uid}` | the admin gate — console-only | every admin page |

**The one thing that will bite you:** `booking.js` and `trail.js` read these with
`snap.docs.map(d => d.data())` — they throw the Firestore document ID away and
key everything off the business ID *inside* the document (`trail_id`, `guide_id`,
`package_id`). Those fields are load-bearing. A trail saved without a `trail_id`
renders as `<option value="">` and can never be selected. The Catalog page always
writes one, generating a slug from the name if you leave the field blank, and the
trails table flags any existing document that's missing it.

---

## 5. What changed in each file

### New (8)
`trailbound-data.js` — the shared layer everything imports
`admin-catalog.html` / `.js` — trails, guides, packages
`admin-orders.html` / `.js` — Maya checkout orders
`admin-support.html` / `.js` — the contact-form inbox
`storefront.js` / `.css` — optional drop-in live cards (see §7)
`site-settings.js` — optional, pushes admin settings to public pages

### Replaced — admin (14)
All six existing admin HTML files, with Catalog / Orders / Support added to the
sidebar. All the admin JS, converted from one-shot reads to live streams.
`admin.css`, which is yours plus a marked block at the end — nothing above that
line changed.

### Replaced — customer (7)
`booking.js` — writes bookings through `createBooking()`, which stamps `uid`
`checkout.js` — one added line stamping `uid` on the order
`login.js` / `login.html` — create the user profile on first sign-in; the stray
backtick and nested `<header>` in login.html are fixed
`products.js` — honours the admin's active/inactive switch, and no longer
crashes on a product added through the admin panel
`trail.js` — live instead of one-shot
`account.js` — live bookings, notifications and wishlist

### Replaced — config (2)
`vite.config.js` — all ten admin pages + `payment-result` added to `input`, and
the service worker told to skip `admin-*`
`firestore.rules` — all twelve collections

### Untouched
`firebase-init.js`, `firebase-config.js`, `cart-store.js`, `cart.js`,
`cart-badge.js`, `header.js`, `auth-nav.js`, `bootstrap-init.js`, `page-init.js`,
`taxonomy.js`, `maya.js`, `shipping-map.js`, `address-check.js`,
`Weather-api.js`, `script.js`, `payment-result.js`, `styles.css`, all other CSS.

---

## 6. Bugs I fixed on the way through

- **Revenue showed ₱0** — the dashboard read `b.price` while the bookings page
  read `b.total_price`. One normaliser now, accepting every variant in your data.
- **Saving a user's role did nothing** — the old handler only changed a local
  variable, so it vanished on refresh.
- **Admin "Disable" on gear did nothing** — `products.js` listed every document
  regardless of status.
- **Admin-created products crashed the shop** — `products.js` assumes
  `p.images[0]`, `p.attributes.size` and `p.specs` exist. True of seeded
  products, false of anything added in admin. The grid would hang on
  "Loading gear…".
- **Trails showed ₱0/person** — `trail.js` renders `base_price` and nothing could
  set it. It's a Catalog field now.
- **The dashboard chart plotted zeros**, and "Top Trails" queried a collection
  that doesn't exist. Both come from real bookings now.
- **The logout modal had no CSS at all** on every admin page but the dashboard.
- **Products had no Edit button**, despite a modal title element that only ever
  said "Add New Product".

---

## 7. Optional — live cards on any public page

Not required for anything above. If you want a trails or gear strip on
`index.html` or anywhere else:

```html
<link rel="stylesheet" href="storefront.css">

<div data-trailbound-trails data-limit="3"></div>
<div data-trailbound-products data-limit="6"></div>

<script type="module" src="storefront.js"></script>
```

Trail cards link to `booking.html?trail=<trail_id>`, which
`preselectTrailFromURL()` already handles — so a click lands on a pre-filled
form. Only open trails and active gear ever render.

For live site settings, add `<script type="module" src="site-settings.js">` and
tag elements with `data-site="name"` or `data-site="year"`.

---

## 8. What still needs a backend — and what I'd do about it

These can't be done safely in a browser. None of them block your demo.

**1. Promoting an admin** — stays a console action. Correct as-is; don't
"fix" it.

**2. Deleting a user** — a browser can't delete a Firebase Auth account. The
Users page disables the profile instead, which the rules and the user-side guard
both honour. Fine for a project.

**3. Payment can be forged.** `payment-result.js` trusts the `status` in the
redirect URL, so anyone can visit
`payment-result.html?order=…&status=success` and mark an order paid. Your own
comment already flags this. **For a school project this is fine** — say so out
loud in your documentation rather than hiding it. The real fix is a Cloud
Function that calls Maya's *Retrieve Payment Status* API server-side, and
"we identified this and scoped it out" is a stronger answer than a silent hole.

**4. Replying to a guest support message** does nothing automatic — a signed-in
sender gets it in their notifications, a guest needs an actual email.

**5. `Weather-api.js` line 20 is still `"YOUR_API_KEY_HERE"`.** Every forecast in
the booking modal is the deterministic fallback, labelled "(Estimated)". Free key
at weatherapi.com. While you're there: that module takes a `coordsOverride` and
is far more accurate for a peak than for its nearest town, but `booking.js`
passes only `trail.location`. The Catalog page has optional lat/lon fields now —
once trails carry coordinates, passing `{ lat, lon }` sharpens it considerably.

---

## 9. Two design decisions to make later

Not now. After the demo.

**The duplicate Firebase app.** `firebase-config.js` calls `initializeApp()` a
second time with the same credentials, so `booking.js`, `cart.js`, `checkout.js`,
`trail.js` and `products.js` run a second Firebase app alongside the one in
`firebase-init.js`. It works — same project — but each app keeps its own
connection and listener pool. The fix is one line (re-export from
`firebase-init.js`), but it means moving every file to one import style in a
single commit, because `firebase-config.js` uses bundled `firebase/firestore`
while `firebase-init.js` uses the gstatic CDN, and a bundled `updateDoc` called
against a CDN-built `db` fails. Everything I've written uses the CDN, so the two
copies never touch. Tidy it when you have a quiet afternoon.

**The cart is per-browser.** `cart-store.js` keeps it in `localStorage`, so it
doesn't follow a signed-in user to another device — your own TODO says as much.
Now that `uid` is on bookings and orders, syncing it to `carts/{uid}` is a
natural next step.

---

## 10. If something doesn't work

**Admin page redirects to login in a loop** — no `admins/{uid}` document. Step 4.

**"Could not be loaded. Check your Firestore rules."** — rules not deployed, or
deployed after the code. Re-run Step 3.

**Booking page dropdown is empty** — no trails with `status` other than
"Closed", or no Active guide assigned. Admin → Catalog, check Bookable Now.

**Guide dropdown empty on a specific trail** — that trail's `guide_id` array is
empty or points at guides that don't exist. The Catalog trails table shows
"N/M active" and flags unknown IDs.

**Trail shows ₱0/person** — `base_price` not set. Catalog → Trails → Edit → From.

**Nothing updates live** — you're on the old one-shot files. Check that the page
imports `trailbound-data.js`.

**Admin pages 404 in production** — old `vite.config.js`, or you didn't re-run
`npm run build`.
