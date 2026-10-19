/* ==========================================================
   Admin — login page + dashboard
   ----------------------------------------------------------
   Both live in this one file because admin-login.html and
   admin-dashboard.html both load it; the body class decides which
   half runs.

   The dashboard is now entirely live. Its four stat cards, the
   trends chart, the top-trails panel and the activity feed are all
   driven by onSnapshot streams, so a booking made by a customer on
   the site moves these numbers while you watch.

   Revenue also finally adds up: every page now reads the amount
   through the same normaliser, instead of one page looking for
   `price` and another for `total_price`.
   ========================================================== */

import {
  attachLogoutConfirm,
  auth,
  collectUnsubscribers,
  escapeHtml,
  isAdmin,
  peso,
  renderAdminSidebarProfile,
  requireAdmin,
  timeAgo,
  toDate,
  watchActivity,
  watchBookings,
  watchGuides,
  watchOrders,
  watchPackages,
  watchProducts,
  watchReviews,
  watchSupportMessages,
  watchSettings,
  watchTrails,
  watchUsers
} from "./trailbound-data.js";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Re-exported so any admin page still importing these from admin.js
// keeps working. New code should import them from trailbound-data.js.
export { attachLogoutConfirm, renderAdminSidebarProfile, isAdmin };

const onLoginPage = document.body.classList.contains("admin-auth-body");
const onDashboardPage = document.body.classList.contains("admin-dashboard-page");

/* ==========================================================
   LOGIN PAGE
   ----------------------------------------------------------
   Admin status is never something a signed-in user can grant
   themselves from the browser. A document at admins/{uid} is the
   only thing that opens the panel, and firestore.rules blocks all
   client writes to that collection.
   ========================================================== */

if (onLoginPage) {
  const emailInput = document.getElementById("admin-email");
  const passwordInput = document.getElementById("admin-password");
  const loginBtn = document.getElementById("admin-secure-login-btn");
  const googleBtn = document.getElementById("admin-google-btn");
  const errorEl = document.getElementById("admin-login-error");
  const toggleBtn = document.getElementById("toggle-password");

  toggleBtn?.addEventListener("click", () => {
    passwordInput.type = passwordInput.type === "password" ? "text" : "password";
  });

  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = () => (errorEl.hidden = true);

  async function handlePostLogin(user) {
    if (await isAdmin(user.uid)) {
      window.location.href = "admin-dashboard.html";
    } else {
      showError("This account is not authorized for admin access.");
      await signOut(auth);
    }
  }

  loginBtn?.addEventListener("click", async () => {
    clearError();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError("Enter both email and password.");
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in...";

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await handlePostLogin(result.user);
    } catch (err) {
      console.error("Admin login error:", err.code, err.message);
      showError("Incorrect email or password.");
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = 'Secure Login <span aria-hidden="true">›</span>';
    }
  });

  googleBtn?.addEventListener("click", async () => {
    clearError();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      const result = await signInWithPopup(auth, provider);
      await handlePostLogin(result.user);
    } catch (err) {
      console.error("Admin Google login error:", err.code, err.message);
      showError("Google sign-in failed. Please try again.");
    }
  });
}

/* ==========================================================
   DASHBOARD
   ========================================================== */

if (onDashboardPage) {
  const track = collectUnsubscribers();

  const el = {
    avatarImg: document.getElementById("admin-avatar"),
    avatarFallback: document.getElementById("admin-avatar-fallback"),
    nameEl: document.getElementById("admin-name"),
    logoutBtn: document.getElementById("admin-logout-btn"),
    search: document.querySelector(".admin-search-wrap input"),
    trendRange: document.getElementById("trend-range"),
    exportBtn: document.querySelector(".admin-export-btn"),
    exportModal: document.getElementById("export-modal"),
    exportBackdrop: document.getElementById("export-modal-backdrop")
  };

  let bookings = [];
  let products = [];
  let guides = [];
  let trails = [];
  let packages = [];
  let users = [];
  let orders = [];
  let reviews = [];
  let activityLog = [];
  let supportMessages = [];
  let chart = null;

  /* The SAME test the orders page uses. Your payment values are not the
     bare word "paid" — Maya writes "Paid (Maya Sandbox)" — so the old
     `=== "paid"` matched none of them and the "collected" figure read
     far lower than the money actually taken. Not `includes`, because
     "Unpaid" contains "paid". */
  const isPaid = (value) => String(value || "").toLowerCase().startsWith("paid");

  attachLogoutConfirm(el.logoutBtn);

  requireAdmin((user) => {
    renderAdminSidebarProfile(user, {
      avatarImg: el.avatarImg,
      avatarFallback: el.avatarFallback,
      nameEl: el.nameEl
    });

    track(
      watchBookings((items) => {
        bookings = items;
        renderStats();
        renderChart();
        renderTopTrails();
      })
    );

    track(
      watchProducts((items) => {
        products = items;
        renderTopTrails();
      }, { includeArchived: true })
    );

    track(
      watchUsers((items) => {
        users = items;
        renderStats();
      })
    );

    /* ADDED. The dashboard never read the `orders` collection, so every
       peso taken through the Products shop was missing from "Total Revenue"
       — the figure only ever covered trail bookings. */
    track(
      watchOrders((items) => {
        orders = items;
        renderStats();
      })
    );

    /* ADDED. Feeds the rating card from real customer reviews. */
    track(
      watchReviews((items) => {
        reviews = items;
        renderStats();
      })
    );

    track(
      watchGuides((items) => {
        guides = items;
      }, { includeArchived: true })
    );

    track(
      watchTrails((items) => {
        trails = items;
      }, { includeArchived: true })
    );

    track(
      watchPackages((items) => {
        packages = items;
      }, { includeArchived: true })
    );

    track(
      watchActivity((items) => {
        activityLog = items;
        renderActivity(items.slice(0, 10));
      }, { max: 300 })
    );

    track(
      watchSupportMessages((items) => {
        supportMessages = items;
      })
    );

    track(
      watchSettings((settings) => {
        document.title = `${settings.siteName} — Dashboard`;
      })
    );
  });

  /* ---------- stat cards ---------- */

  function renderStats() {
    setText("stat-total-users", users.length.toLocaleString());
    setText(
      "stat-total-users-delta",
      `${users.filter((u) => !u.disabled).length} active`
    );

    const activeBookings = bookings.filter((b) =>
      ["pending", "confirmed", "active"].includes(b.status)
    );
    setText("stat-active-bookings", activeBookings.length.toLocaleString());
    setText("stat-active-bookings-delta", `${bookings.length} all time`);

    /* REVENUE — now both halves of the business.

       Bookings that were not cancelled, PLUS Products orders that were not
       cancelled or refunded. The orders half was simply absent before,
       so a shop with sales showed none of them here. */
    const liveBookings = bookings.filter((b) => b.status !== "cancelled");
    const liveOrders = orders.filter(
      (o) => !["cancelled", "refunded"].includes(String(o.status || "").toLowerCase())
    );

    const booked = liveBookings.reduce((sum, b) => sum + b.amount, 0);
    const ordered = liveOrders.reduce((sum, o) => sum + o.total, 0);
    setText("stat-total-revenue", peso(booked + ordered));

    const collected =
      liveBookings.filter((b) => isPaid(b.paymentStatus)).reduce((sum, b) => sum + b.amount, 0) +
      liveOrders.filter((o) => isPaid(o.paymentStatus)).reduce((sum, o) => sum + o.total, 0);

    /* Says what the headline actually is. "Total Revenue" counts money
       booked, not money received, and those are very different numbers
       when orders sit unpaid. */
    setText("stat-total-revenue-delta", `${peso(collected)} collected`);

    /* The split lives in its own two-column list rather than being
       crammed onto the delta line, which wrapped and read as noise. */
    const split = document.getElementById("stat-revenue-split");
    if (split) {
      setText("stat-revenue-trails", peso(booked));
      setText("stat-revenue-Products", peso(ordered));
      split.hidden = !(booked || ordered);
    }

    /* AVERAGE RATING — a real one.

       This card used to be relabelled "Avg Booking Value" at runtime
       and filled with revenue / booking count, because the comment
       said a reviews collection did not exist yet. It does:
       product_reviews, the same data the shop's popularity sort uses.

       The relabelling was done with previousElementSibling, which
       silently targets the wrong element the moment anyone adds
       anything to that card. The label is correct in the HTML now and
       nothing rewrites it. */
    const rated = reviews.filter((r) => Number.isFinite(r.rating));
    if (rated.length) {
      const avg = rated.reduce((sum, r) => sum + r.rating, 0) / rated.length;
      const full = Math.round(avg);
      setText("stat-avg-rating", avg.toFixed(2));
      setText(
        "stat-avg-rating-stars",
        `${"\u2605".repeat(full)}${"\u2606".repeat(5 - full)} from ${rated.length} review${
          rated.length === 1 ? "" : "s"
        }`
      );
    } else {
      // An empty state, not a zero. Nobody has rated anything; that is
      // not the same as everything scoring nought.
      setText("stat-avg-rating", "\u2014");
      setText("stat-avg-rating-stars", reviews.length ? "no usable ratings yet" : "no reviews yet");
    }
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  /* ---------- trends chart ---------- */

  function renderChart() {
    const canvas = document.getElementById("booking-trends-chart");
    if (!canvas || typeof Chart === "undefined") return;

    const days = (el.trendRange?.value || "").includes("30") ? 30 : 7;
    const buckets = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i -= 1) {
      const day = new Date(today.getTime() - i * 86400000);
      buckets.push({ day, count: 0 });
    }

    // Real per-day counts, taken from each booking's created stamp.
    bookings.forEach((b) => {
      const created = toDate(b.createdAt) || (b.date ? new Date(`${b.date}T00:00:00`) : null);
      if (!created) return;
      created.setHours(0, 0, 0, 0);
      const bucket = buckets.find((slot) => slot.day.getTime() === created.getTime());
      if (bucket) bucket.count += 1;
    });

    const labels = buckets.map((slot) =>
      days === 7
        ? slot.day.toLocaleDateString("en-US", { weekday: "short" })
        : String(slot.day.getDate())
    );

    chart?.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data: buckets.map((slot) => slot.count),
            borderColor: "#ff5a45",
            backgroundColor: "rgba(255, 90, 69, 0.15)",
            fill: true,
            tension: 0.35,
            pointRadius: 3
          }
        ]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: { color: "rgba(245,239,233,0.5)" }
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: { color: "rgba(245,239,233,0.5)", precision: 0 }
          }
        }
      }
    });
  }

  /* ---------- top trails ---------- */

  function renderTopTrails() {
    const host = document.getElementById("top-trails-list");
    if (!host) return;

    // Ranked from actual bookings rather than a separate counter
    // field that nothing was keeping up to date.
    const tally = new Map();
    bookings.forEach((b) => {
      if (!b.trailName || b.trailName === "-") return;
      const entry = tally.get(b.trailName) || { name: b.trailName, count: 0, revenue: 0 };
      entry.count += 1;
      if (b.status !== "cancelled") entry.revenue += b.amount;
      tally.set(b.trailName, entry);
    });

    let top = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 3);

    // Nothing booked yet — show the newest published products instead.
    if (!top.length) {
      /* FIXED — this filtered on p.status === "active", and your product
         documents have no `status` field at all; availability on them is
         `inStock`. normalizeProduct used to default the missing field to
         "active", which made this work by accident; once it started
         reporting the field as genuinely absent, this fallback matched
         nothing and the panel went blank. inStock is the real field. */
      top = products
        .filter((p) => p.inStock && !p.archived)
        .slice(0, 3)
        .map((p) => ({ name: p.name, count: 0, revenue: p.price, image: p.image }));
    }

    if (!top.length) {
      host.innerHTML = '<p class="admin-empty">No trail data yet.</p>';
      return;
    }

    host.innerHTML = top
      .map((item) => {
        const product = products.find((p) => p.name === item.name);
        const image = item.image || product?.image || "";
        return `<div class="admin-top-trail-item">
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="" class="admin-top-trail-img" loading="lazy">`
            : '<div class="admin-top-trail-img"></div>'
        }
        <div class="admin-top-trail-info">
          <p class="admin-top-trail-name">${escapeHtml(item.name)}</p>
          <p class="admin-top-trail-meta">${item.count} booking${
          item.count === 1 ? "" : "s"
        }</p>
        </div>
        <span class="admin-top-trail-delta">${peso(item.revenue)}</span>
      </div>`;
      })
      .join("");
  }

  /* ---------- recent activity ---------- */

  function renderActivity(entries) {
    const tbody = document.getElementById("recent-activity-body");
    if (!tbody) return;

    if (!entries.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="admin-empty">No recent activity yet.</td></tr>';
      return;
    }

    tbody.innerHTML = entries
      .map((a) => {
        const statusClass =
          a.status === "completed" || a.status === "confirmed"
            ? "admin-status-badge--completed"
            : a.status === "pending"
            ? "admin-status-badge--pending"
            : "admin-status-badge--system";
        return `<tr>
        <td><div class="admin-activity-user">${
          a.userPhoto
            ? `<img src="${escapeHtml(
                a.userPhoto
              )}" class="admin-activity-avatar" alt="" referrerpolicy="no-referrer">`
            : '<div class="admin-activity-avatar"></div>'
        }${escapeHtml(a.userName || "Unknown")}</div></td>
        <td>${escapeHtml(a.activity || "")}</td>
        <td>${a.amount ? peso(a.amount) : "—"}</td>
        <td><span class="admin-status-badge ${statusClass}">${escapeHtml(
          a.status || ""
        )}</span></td>
        <td>${escapeHtml(timeAgo(a.createdAt))}</td>
      </tr>`;
      })
      .join("");
  }

  /* ---------- search + export ---------- */

  el.search?.addEventListener("input", () => {
    const term = el.search.value.trim().toLowerCase();
    document
      .querySelectorAll(".admin-top-trail-item, #recent-activity-body tr")
      .forEach((item) => {
        item.hidden = Boolean(term && !item.textContent.toLowerCase().includes(term));
      });
  });

  el.trendRange?.addEventListener("change", renderChart);

  function closeExportModal() {
    el.exportModal.hidden = true;
    el.exportBackdrop.hidden = true;
  }

  el.exportBtn?.addEventListener("click", () => {
    el.exportModal.hidden = false;
    el.exportBackdrop.hidden = false;
  });
  document.getElementById("export-modal-close")?.addEventListener("click", closeExportModal);
  document.getElementById("export-modal-cancel")?.addEventListener("click", closeExportModal);
  el.exportBackdrop?.addEventListener("click", closeExportModal);

  document.querySelectorAll(".admin-export-option").forEach((option) =>
    option.addEventListener("click", () => {
      document
        .querySelectorAll(".admin-export-option")
        .forEach((item) => item.classList.remove("is-selected"));
      option.classList.add("is-selected");
    })
  );
  document.querySelectorAll(".admin-export-formats button").forEach((format) =>
    format.addEventListener("click", () => {
      document
        .querySelectorAll(".admin-export-formats button")
        .forEach((item) => item.classList.remove("is-selected"));
      format.classList.add("is-selected");
    })
  );

  const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const reportValue = (value) => {
    if (value == null) return "";
    if (typeof value !== "object") return value;
    return toDate(value)?.toISOString() || JSON.stringify(value);
  };
  const pdfValue = (value) => {
    if (Array.isArray(value)) return value.map((item) => String(reportValue(item) ?? "")).filter(Boolean).join("; ");
    return reportValue(value);
  };
  const money = (value) => peso(Number(value) || 0);
  const amountOf = (records, key) => records.reduce((sum, record) => sum + (Number(record[key]) || 0), 0);
  const isVoided = (record) => ["cancelled", "canceled", "refunded"].includes(
    String(record.status || "").toLowerCase()
  );
  const itemDescription = (items) => (Array.isArray(items) ? items : [])
    .map((item) => {
      const name = item.name || item.title || "Item";
      const quantity = Number(item.qty ?? item.quantity) || 1;
      const price = Number(item.price ?? item.unitPrice);
      const options = [item.size, item.color].filter(Boolean).join(" / ");
      const amount = Number.isFinite(price) ? ` @ ${money(price)} = ${money(price * quantity)}` : "";
      return `${name}${options ? ` (${options})` : ""} × ${quantity}${amount}`;
    })
    .join("; ");

  document.getElementById("export-modal-submit")?.addEventListener("click", () => {
    const category =
      document.querySelector(".admin-export-option.is-selected")?.dataset.category || "overview";
    const format =
      document.querySelector(".admin-export-formats .is-selected")?.dataset.format || "csv";

    // Exports now pull from the live data, not from the text
    // already painted into the stat cards.
    let rows;
    let reportSummary = [];
    if (category === "bookings") {
      const validBookings = bookings.filter((booking) => !isVoided(booking));
      const bookingTotal = amountOf(validBookings, "amount");
      const collected = validBookings
        .filter((booking) => isPaid(booking.paymentStatus))
        .reduce((sum, booking) => sum + (Number(booking.amount) || 0), 0);
      reportSummary = [
        ["Total bookings", bookings.length],
        ["Cancelled bookings", bookings.length - validBookings.length],
        ["Booking value (excluding cancelled)", money(bookingTotal)],
        ["Payments collected", money(collected)],
        ["Outstanding balance", money(Math.max(0, bookingTotal - collected))]
      ];
      rows = [
        ["Booking ID", "Customer", "Email", "Trail", "Package", "Guide", "Date", "Group Size", "Activity", "Amount", "Booking Status", "Payment Status"],
        ...bookings.map((b) => [
          b.orderId,
          b.customerName,
          b.email,
          b.trailName,
          b.packageName,
          b.guideName,
          b.date,
          b.groupSize,
          b.activity,
          b.amount,
          b.statusLabel,
          b.paymentStatusLabel
        ])
      ];
    } else if (category === "users") {
      rows = [
        ["Name", "Email", "Role", "Status"],
        ...users.map((u) => [
          u.displayName,
          u.email,
          u.role,
          u.disabled ? "disabled" : "active"
        ])
      ];
    } else if (category === "sales") {
      const validBookings = bookings.filter((booking) => !isVoided(booking));
      const validOrders = orders.filter((order) => !isVoided(order));
      const salesByItem = new Map();
      validBookings.forEach((booking) => {
        const name = booking.trailName || "Unassigned trail";
        const entry = salesByItem.get(`Trail booking|${name}`) || {
          channel: "Trail booking", name, units: 0, transactions: 0, sales: 0
        };
        entry.units += 1;
        entry.transactions += 1;
        entry.sales += Number(booking.amount) || 0;
        salesByItem.set(`Trail booking|${name}`, entry);
      });
      validOrders.forEach((order) => {
        (order.items || []).forEach((item) => {
          const name = item.name || "Unspecified product";
          const key = `Product order|${name}`;
          const entry = salesByItem.get(key) || {
            channel: "Product order", name, units: 0, transactions: 0, sales: 0
          };
          const quantity = Number(item.qty ?? item.quantity) || 1;
          const price = Number(item.price ?? item.unitPrice) || 0;
          entry.units += quantity;
          entry.transactions += 1;
          entry.sales += price * quantity;
          salesByItem.set(key, entry);
        });
        if (order.shippingFee > 0) {
          const key = "Product order|Shipping fees";
          const entry = salesByItem.get(key) || {
            channel: "Product order", name: "Shipping fees", units: 0, transactions: 0, sales: 0
          };
          entry.units += 1;
          entry.transactions += 1;
          entry.sales += Number(order.shippingFee) || 0;
          salesByItem.set(key, entry);
        }
      });
      const bookingSales = amountOf(validBookings, "amount");
      const orderSales = amountOf(validOrders, "total");
      const allCollected =
        validBookings.filter((booking) => isPaid(booking.paymentStatus))
          .reduce((sum, booking) => sum + (Number(booking.amount) || 0), 0) +
        validOrders.filter((order) => isPaid(order.paymentStatus))
          .reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      reportSummary = [
        ["Trail booking sales", money(bookingSales)],
        ["Product order sales (including shipping)", money(orderSales)],
        ["Total sales", money(bookingSales + orderSales)],
        ["Payments collected", money(allCollected)],
        ["Outstanding balance", money(Math.max(0, bookingSales + orderSales - allCollected))]
      ];
      rows = [
        ["Sales Channel", "Item", "Units", "Transactions", "Sales"],
        ...[...salesByItem.values()].map((entry) => [
          entry.channel, entry.name, entry.units, entry.transactions, entry.sales
        ])
      ];
    } else if (category === "products") {
      const activeProducts = products.filter((product) => !product.archived && product.inStock);
      const trackedProducts = products.filter((product) => product.hasQuantity);
      const trackedUnits = trackedProducts.reduce((sum, product) => sum + product.quantity, 0);
      const inventoryValue = trackedProducts.reduce(
        (sum, product) => sum + (product.salePrice || product.price) * product.quantity,
        0
      );
      reportSummary = [
        ["Total products", products.length],
        ["Available products", activeProducts.length],
        ["Archived products", products.filter((product) => product.archived).length],
        ["Tracked stock units", trackedUnits],
        ["Tracked inventory value (current price)", money(inventoryValue)],
        ["Products without stock tracking", products.length - trackedProducts.length]
      ];
      rows = [
        ["ID", "Name", "Category", "Subcategory", "Regular Price", "Current Price", "In Stock", "Quantity", "Stock Value", "Status", "Archived"],
        ...products.map((p) => [
          p.id, p.name, p.category, p.subcategory, p.price, p.salePrice || p.price,
          p.inStock, p.hasQuantity ? p.quantity : "Not tracked",
          p.hasQuantity ? (p.salePrice || p.price) * p.quantity : "Not tracked",
          p.status || (p.inStock ? "active" : "inactive"), p.archived
        ])
      ];
    } else if (category === "guides") {
      rows = [
        ["ID", "Name", "Specialty", "Contact", "Years Experience", "Rating", "Status", "Archived"],
        ...guides.map((g) => [
          g.id, g.fullName, g.specialty, g.contact, g.yearsExperience, g.rating, g.status, g.archived
        ])
      ];
    } else if (category === "trails") {
      rows = [
        ["ID", "Name", "Location", "Difficulty", "Duration", "Base Price", "Status", "Guide IDs", "Archived"],
        ...trails.map((t) => [
          t.id, t.name, t.location, t.difficulty, t.duration, t.basePrice, t.status, t.guideIds, t.archived
        ])
      ];
    } else if (category === "packages") {
      const livePackages = packages.filter((pkg) => !pkg.archived);
      reportSummary = [
        ["Total packages", packages.length],
        ["Available packages", livePackages.length],
        ["Archived packages", packages.length - livePackages.length],
        ["Combined listed rate (per person)", money(livePackages.reduce((sum, pkg) => sum + (Number(pkg.pricePerPax) || 0), 0))],
        ["Lowest listed rate (per person)", money(livePackages.length ? Math.min(...livePackages.map((pkg) => pkg.pricePerPax)) : 0)],
        ["Highest listed rate (per person)", money(livePackages.length ? Math.max(...livePackages.map((pkg) => pkg.pricePerPax)) : 0)]
      ];
      rows = [
        ["ID", "Package", "Rate Per Person", "Includes", "Activity Choice Required", "Accommodation Required", "Archived"],
        ...packages.map((p) => [
          p.id, p.name, p.pricePerPax, p.includes, p.requiresActivityChoice, p.requiresAccommodation, p.archived
        ])
      ];
    } else if (category === "orders") {
      const validOrders = orders.filter((order) => !isVoided(order));
      const orderTotal = amountOf(validOrders, "total");
      const collected = validOrders
        .filter((order) => isPaid(order.paymentStatus))
        .reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      reportSummary = [
        ["Total orders", orders.length],
        ["Cancelled / refunded orders", orders.length - validOrders.length],
        ["Merchandise subtotal", money(amountOf(validOrders, "subtotal"))],
        ["Shipping collected", money(amountOf(validOrders, "shippingFee"))],
        ["Order total (excluding cancelled / refunded)", money(orderTotal)],
        ["Payments collected", money(collected)],
        ["Outstanding balance", money(Math.max(0, orderTotal - collected))]
      ];
      rows = [
        ["ID", "Order ID", "Customer", "Email", "Phone", "Shipping Address", "Items", "Subtotal", "Shipping Fee", "Grand Total", "Status", "Payment Status", "Payment Method", "Checkout ID", "Created"],
        ...orders.map((o) => [
          o.id, o.orderId, o.customerName, o.email, o.phone,
          [o.shipping?.address, o.shipping?.city, o.shipping?.region, o.shipping?.zip].filter(Boolean).join(", "),
          itemDescription(o.items),
          o.subtotal, o.shippingFee, o.total, o.status, o.paymentStatus,
          o.paymentMethod, o.checkoutId, reportValue(o.createdAt)
        ])
      ];
    } else if (category === "reviews") {
      rows = [
        ["ID", "Product ID", "Name", "Rating", "Comment", "Created"],
        ...reviews.map((r) => [
          r.id, r.productId, r.name, r.rating ?? r.rawRating, r.comment, reportValue(r.createdAt)
        ])
      ];
    } else if (category === "activity-log") {
      rows = [
        ["ID", "Date", "Actor", "Action", "Entity", "Entity ID", "Entity Label", "Summary", "Status", "Amount", "Changes"],
        ...activityLog.map((a) => [
          a.id, reportValue(a.createdAt), a.actorName || a.userName, a.action, a.entity,
          a.entityId, a.entityLabel, a.summary || a.activity, a.status, a.amount, a.changes
        ])
      ];
    } else if (category === "support") {
      rows = [
        ["ID", "Reference", "Name", "Email", "Phone", "Subject", "Message", "Status", "Order ID", "Replies", "Created", "Updated"],
        ...supportMessages.map((m) => [
          m.id, m.ref, m.name, m.email, m.phone, m.subject, m.message,
          m.status, m.orderId, m.thread, reportValue(m.createdAt), reportValue(m.updatedAt)
        ])
      ];
    } else {
      const validBookings = bookings.filter((booking) => !isVoided(booking));
      const validOrders = orders.filter((order) => !isVoided(order));
      const bookingTotal = amountOf(validBookings, "amount");
      const orderTotal = amountOf(validOrders, "total");
      const totalSales = bookingTotal + orderTotal;
      const collected =
        validBookings.filter((booking) => isPaid(booking.paymentStatus))
          .reduce((sum, booking) => sum + (Number(booking.amount) || 0), 0) +
        validOrders.filter((order) => isPaid(order.paymentStatus))
          .reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      reportSummary = [
        ["Total revenue (excluding cancelled / refunded)", money(totalSales)],
        ["Payments collected", money(collected)],
        ["Outstanding balance", money(Math.max(0, totalSales - collected))]
      ];
      rows = [
        ["Metric", "Value"],
        ["Report date", new Date().toISOString().slice(0, 10)],
        ["Total users", users.length],
        ["Total bookings", bookings.length],
        ["Active bookings", bookings.filter((booking) => ["pending", "confirmed", "active"].includes(booking.status)).length],
        ["Cancelled bookings", bookings.filter(isVoided).length],
        ["Booking sales", money(bookingTotal)],
        ["Product orders", orders.length],
        ["Product order sales", money(orderTotal)],
        ["Published products", products.filter((product) => product.status === "active" && !product.archived).length],
        ["Available trails", trails.filter((trail) => !trail.archived && trail.isOpen).length],
        ["Available guides", guides.filter((guide) => !guide.archived && guide.isActive).length],
        ["Available packages", packages.filter((pkg) => !pkg.archived).length],
        ["Total reviews", reviews.length],
        ["Support messages", supportMessages.length],
        ["Total sales", money(totalSales)],
        ["Payments collected", money(collected)],
        ["Outstanding balance", money(Math.max(0, totalSales - collected))]
      ];
    }

    const csvRows = reportSummary.length
      ? [...rows, [], ["REPORT TOTALS"], ...reportSummary]
      : rows;
    const csv = csvRows.map((row) => row.map((value) => csvCell(reportValue(value))).join(",")).join("\r\n");

    if (format === "pdf") {
      const win = window.open("", "_blank");
      if (!win) {
        window.alert("The report could not open because the browser blocked the new window. Allow pop-ups and try again.");
        return;
      }

      const title = {
        "activity-log": "Activity Log",
        bookings: "Bookings",
        guides: "Guides",
        orders: "Orders",
        overview: "Overview",
        packages: "Packages",
        products: "Products",
        reviews: "Reviews",
        sales: "Sales",
        support: "Support",
        trails: "Trails",
        users: "Users"
      }[category] || category;
      const [headers, ...records] = rows;
      const generatedAt = new Date().toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
      const summaryCards = reportSummary.length
        ? `<section class="totals">
            <h2 class="section-title">Report totals</h2>
            <div class="summary-grid">${reportSummary.map(([label, value]) => `
            <article class="summary-card">
              <span>${escapeHtml(pdfValue(label))}</span>
              <strong>${escapeHtml(pdfValue(value))}</strong>
            </article>`).join("")}</div>
          </section>`
        : "";
      const bookingCards = category === "bookings"
        ? `<div class="record-list">${bookings.length ? bookings.map((booking) => `
            <article class="record-card">
              <header><div><h3>${escapeHtml(booking.trailName || "Trail booking")}</h3><p>${escapeHtml(booking.orderId || "")} · ${escapeHtml(booking.customerName || "Customer not listed")}</p></div><strong>${escapeHtml(money(booking.amount))}</strong></header>
              <div class="record-grid">
                <span><b>Date</b>${escapeHtml(booking.date || "—")}</span>
                <span><b>Group size</b>${escapeHtml(booking.groupSize ?? "—")}</span>
                <span><b>Package</b>${escapeHtml(booking.packageName || "—")}</span>
                <span><b>Guide</b>${escapeHtml(booking.guideName || "—")}</span>
                <span><b>Activity</b>${escapeHtml(booking.activity || "—")}</span>
                <span><b>Booking / payment</b>${escapeHtml(booking.statusLabel || booking.status)} / ${escapeHtml(booking.paymentStatusLabel || booking.paymentStatus)}</span>
                <span><b>Email / phone</b>${escapeHtml([booking.email, booking.phone].filter(Boolean).join(" · ") || "—")}</span>
              </div>
            </article>`).join("") : '<p class="no-records">No bookings to display.</p>'}</div>`
        : "";
      const orderCards = category === "orders"
        ? `<div class="record-list">${orders.length ? orders.map((order) => `
            <article class="record-card">
              <header><div><h3>Order ${escapeHtml(order.orderId)}</h3><p>${escapeHtml(order.customerName || "Customer not listed")} · ${escapeHtml(reportValue(order.createdAt) || "Date not listed")}</p></div><strong>${escapeHtml(money(order.total))}</strong></header>
              <div class="record-grid">
                <span><b>Email</b>${escapeHtml(order.email || "—")}</span>
                <span><b>Phone</b>${escapeHtml(order.phone || "—")}</span>
                <span><b>Status</b>${escapeHtml(order.status || "—")}</span>
                <span><b>Payment</b>${escapeHtml(order.paymentStatus || "—")} · ${escapeHtml(order.paymentMethod || "Method not listed")}</span>
                <span class="wide"><b>Shipping address</b>${escapeHtml([order.shipping?.address, order.shipping?.city, order.shipping?.region, order.shipping?.zip].filter(Boolean).join(", ") || "No shipping address")}</span>
                <span><b>Checkout reference</b>${escapeHtml(order.checkoutId || "—")}</span>
              </div>
              <table class="order-items">
                <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
                <tbody>${order.items?.length ? order.items.map((item) => {
                  const quantity = Number(item.qty ?? item.quantity) || 1;
                  const price = Number(item.price ?? item.unitPrice);
                  const options = [item.size, item.color].filter(Boolean).join(" / ");
                  return `<tr>
                    <td>${escapeHtml(item.name || item.title || "Item")}${options ? `<small>${escapeHtml(options)}</small>` : ""}</td>
                    <td>${quantity}</td>
                    <td>${Number.isFinite(price) ? escapeHtml(money(price)) : "—"}</td>
                    <td>${Number.isFinite(price) ? escapeHtml(money(price * quantity)) : "—"}</td>
                  </tr>`;
                }).join("") : `<tr><td colspan="4" class="no-records">No product items recorded.</td></tr>`}</tbody>
              </table>
              <div class="receipt-totals"><span>Merchandise <b>${escapeHtml(money(order.subtotal))}</b></span><span>Shipping <b>${escapeHtml(money(order.shippingFee))}</b></span><span>Order total <b>${escapeHtml(money(order.total))}</b></span></div>
            </article>`).join("") : '<p class="no-records">No orders to display.</p>'}</div>`
        : "";
      const table = bookingCards || orderCards
        ? bookingCards || orderCards
        : `<div class="table-wrap"><table>
            <thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(pdfValue(header))}</th>`).join("")}</tr></thead>
            <tbody>${records.length
              ? records.map((record) => `<tr>
                  ${record.map((value, column) => `<td${column === 0 ? ' class="identifier"' : ""}>${escapeHtml(pdfValue(value)) || '<span class="empty">—</span>'}</td>`).join("")}
                </tr>`).join("")
              : `<tr><td class="no-records" colspan="${headers.length}">No ${escapeHtml(title.toLowerCase())} records to display.</td></tr>`
            }</tbody>
          </table></div>`;
      const recordCount = category === "overview"
        ? "Business summary"
        : `${(category === "bookings" ? bookings : category === "orders" ? orders : records).length.toLocaleString()} record${(category === "bookings" ? bookings : category === "orders" ? orders : records).length === 1 ? "" : "s"}`;

      win.document.write(`<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Trailbound ${escapeHtml(title)} Report</title>
            <style>
              @page { size: A4 landscape; margin: 13mm 12mm 15mm; }
              * { box-sizing: border-box; }
              body { margin: 0; color: #2b211b; background: #f2eee8; font: 10px/1.45 Arial, Helvetica, sans-serif; }
              .report { max-width: 1400px; margin: 28px auto; padding: 34px 38px; background: #fff; box-shadow: 0 8px 30px rgba(40, 23, 15, .12); }
              .report-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 20px; border-bottom: 2px solid #a8592f; }
              .brand { margin: 0 0 8px; color: #8f4a26; font-size: 9px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
              h1 { margin: 0; color: #2a0f06; font-size: 26px; line-height: 1.15; }
              .subtitle { margin: 7px 0 0; color: #78695e; font-size: 11px; }
              .report-mark { flex: 0 0 auto; padding: 7px 11px; border: 1px solid #e2d8c4; border-radius: 999px; color: #6b5c4c; font-size: 9px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
              .report-meta { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 14px 0 18px; color: #6b5c4c; font-size: 9px; }
              .report-meta strong { color: #2b211b; }
              .section-title { margin: 0 0 9px; color: #2a0f06; font-size: 12px; }
              .totals { margin: 0 0 20px; }
              .table-wrap { width: 100%; }
              table { width: 100%; border-collapse: collapse; table-layout: auto; }
              thead { display: table-header-group; }
              th { padding: 8px 7px; background: #2a0f06; color: #fff8ec; font-size: 8px; font-weight: 700; letter-spacing: .04em; text-align: left; text-transform: uppercase; vertical-align: bottom; }
              td { max-width: 190px; padding: 7px; border-bottom: 1px solid #ece6dd; color: #3d342e; font-size: 9px; text-align: left; vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; }
              tbody tr:nth-child(even) { background: #faf8f5; }
              tbody tr { break-inside: avoid; page-break-inside: avoid; }
              td.identifier { color: #78695e; font-family: Consolas, monospace; font-size: 8px; }
              .empty { color: #aaa096; }
              .no-records { padding: 24px 10px; color: #78695e; text-align: center; }
              .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
              .summary-card { padding: 16px; border: 1px solid #e8dfd4; border-radius: 8px; background: #faf8f5; }
              .summary-card span { display: block; margin-bottom: 5px; color: #78695e; font-size: 9px; text-transform: uppercase; letter-spacing: .07em; }
              .summary-card strong { color: #2a0f06; font-size: 17px; }
              .record-list { display: grid; gap: 11px; }
              .record-card { padding: 13px 15px; border: 1px solid #e8dfd4; border-radius: 7px; break-inside: avoid; page-break-inside: avoid; }
              .record-card > header { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 9px; border-bottom: 1px solid #ece6dd; }
              .record-card h3 { margin: 0; color: #2a0f06; font-size: 12px; }
              .record-card header p { margin: 3px 0 0; color: #78695e; font-size: 9px; }
              .record-card header > strong { color: #8f4a26; font-size: 14px; white-space: nowrap; }
              .record-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px 14px; padding: 10px 0; }
              .record-grid span { min-width: 0; overflow-wrap: anywhere; }
              .record-grid .wide { grid-column: span 2; }
              .record-grid b { display: block; margin-bottom: 2px; color: #78695e; font-size: 8px; letter-spacing: .04em; text-transform: uppercase; }
              .order-items { margin-top: 4px; }
              .order-items th { padding: 6px 7px; }
              .order-items td { padding: 6px 7px; }
              .order-items td small { display: block; color: #78695e; font-size: 8px; }
              .receipt-totals { display: flex; justify-content: flex-end; gap: 20px; padding-top: 8px; border-top: 1px solid #ece6dd; color: #6b5c4c; font-size: 9px; }
              .receipt-totals b { margin-left: 5px; color: #2a0f06; }
              .report-footer { margin-top: 18px; padding-top: 9px; border-top: 1px solid #ece6dd; color: #94867a; font-size: 8px; }
              @media print {
                body { background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                .report { max-width: none; margin: 0; padding: 0; box-shadow: none; }
              }
            </style>
          </head>
          <body>
            <main class="report">
              <header class="report-header">
                <div>
                  <p class="brand">Trailbound · Admin</p>
                  <h1>${escapeHtml(title)} Report</h1>
                  <p class="subtitle">A clear snapshot of your ${escapeHtml(title.toLowerCase())} data.</p>
                </div>
                <span class="report-mark">Data report</span>
              </header>
              <div class="report-meta">
                <span><strong>${escapeHtml(recordCount)}</strong></span>
                <span>Generated <strong>${escapeHtml(generatedAt)}</strong></span>
              </div>
              ${summaryCards}
              <h2 class="section-title">${escapeHtml(title)} ${category === "overview" ? "Summary" : "Records"}</h2>
              ${table}
              <footer class="report-footer">Trailbound Admin · Generated ${escapeHtml(generatedAt)}</footer>
            </main>
          </body>
        </html>`);
      win.document.close();
      win.setTimeout(() => {
        win.focus();
        win.print();
      }, 250);
    } else {
      const blob = new Blob(["﻿" + csv], {
        type: format === "excel" ? "application/vnd.ms-excel" : "text/csv;charset=utf-8"
      });
      const link = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(blob),
        download: `trailbound-${category}-report.${format === "excel" ? "xls" : "csv"}`
      });
      link.click();
      URL.revokeObjectURL(link.href);
    }

    closeExportModal();
  });
}

/* ==========================================================
   SETUP NOTE — adding your first admin
   ----------------------------------------------------------
   1. Sign in normally once via login.html so a Firebase Auth
      account exists for you.
   2. Firebase console -> Authentication -> Users -> copy your UID.
   3. Firestore -> Start collection -> collection ID: admins
      -> Document ID: paste your UID -> add role: "admin" -> Save.
   4. admin-login.html will now let that account through.

   firestore.rules (shipped alongside this file) already locks the
   admins collection so it can never be written from a browser.
   ========================================================== */