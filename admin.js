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
  watchOrders,
  watchProducts,
  watchReviews,
  watchSettings,
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
  let users = [];
  let orders = [];
  let reviews = [];
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
      })
    );

    track(
      watchUsers((items) => {
        users = items;
        renderStats();
      })
    );

    /* ADDED. The dashboard never read the `orders` collection, so every
       peso taken through the gear shop was missing from "Total Revenue"
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

    track(watchActivity(renderActivity, { max: 10 }));

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

       Bookings that were not cancelled, PLUS gear orders that were not
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
      setText("stat-revenue-gear", peso(ordered));
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

  document.getElementById("export-modal-submit")?.addEventListener("click", () => {
    const category =
      document.querySelector(".admin-export-option.is-selected")?.dataset.category || "overview";
    const format =
      document.querySelector(".admin-export-formats .is-selected")?.dataset.format || "csv";

    // Exports now pull from the live data, not from the text
    // already painted into the stat cards.
    let rows;
    if (category === "bookings") {
      rows = [
        ["Order ID", "Customer", "Trail", "Date", "Amount", "Status"],
        ...bookings.map((b) => [
          b.orderId,
          b.customerName,
          b.trailName,
          b.date,
          b.amount,
          b.status
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
      rows = [
        ["Trail", "Bookings", "Revenue"],
        ...[...bookings.reduce((map, b) => {
          const entry = map.get(b.trailName) || { count: 0, revenue: 0 };
          entry.count += 1;
          if (b.status !== "cancelled") entry.revenue += b.amount;
          map.set(b.trailName, entry);
          return map;
        }, new Map())].map(([name, entry]) => [name, entry.count, entry.revenue])
      ];
    } else {
      const revenue = bookings
        .filter((b) => b.status !== "cancelled")
        .reduce((sum, b) => sum + b.amount, 0);
      rows = [
        ["Trailbound Admin Report", new Date().toISOString().slice(0, 10)],
        ["Total Users", users.length],
        ["Total Bookings", bookings.length],
        ["Active Bookings", bookings.filter((b) => ["pending", "confirmed"].includes(b.status)).length],
        ["Published Products", products.filter((p) => p.status === "active").length],
        ["Total Revenue", revenue]
      ];
    }

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

    if (format === "pdf") {
      const win = window.open("", "_blank");
      win.document.write(
        `<title>Trailbound report</title><h1>Trailbound ${category} report</h1><pre>${csv.replaceAll(
          "<",
          "&lt;"
        )}</pre>`
      );
      win.document.close();
      win.print();
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