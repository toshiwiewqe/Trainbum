/* ==========================================================
   Admin — Support inbox
   ----------------------------------------------------------
   contact.js writes every submitted message to the `contact`
   collection and always has. Nothing read them back, so support
   requests have been landing in Firestore unseen.

   Replying marks the thread handled, and for a customer who was
   signed in when they wrote (contact.js stores user_id) the reply
   also lands in their account notifications, which their open tab
   picks up live.
   ========================================================== */

import {
  attachLogoutConfirm,
  collectUnsubscribers,
  escapeHtml,
  renderAdminSidebarProfile,
  replyToMessage,
  requireAdmin,
  timeAgo,
  toDate,
  updateMessageStatus,
  watchSupportMessages
} from "./trailbound-data.js";

const track = collectUnsubscribers();

const TOPICS = {
  booking: "Trail booking",
  order: "Order / Products",
  account: "Account",
  other: "Something else"
};

const el = {
  search: document.getElementById("support-search"),
  filter: document.getElementById("support-filter"),
  body: document.getElementById("support-body"),
  feedback: document.getElementById("support-feedback"),
  modal: document.getElementById("support-modal"),
  backdrop: document.getElementById("support-modal-backdrop"),
  modalBody: document.getElementById("support-modal-body"),
  modalTitle: document.getElementById("support-modal-title"),
  form: document.getElementById("support-reply-form"),
  reply: document.getElementById("support-reply"),
  replyNote: document.getElementById("support-reply-note"),
  avatarImg: document.getElementById("admin-avatar"),
  avatarFallback: document.getElementById("admin-avatar-fallback"),
  nameEl: document.getElementById("admin-name"),
  logoutBtn: document.getElementById("admin-logout-btn")
};

let messages = [];
let active = null;

attachLogoutConfirm(el.logoutBtn);

requireAdmin((user) => {
  renderAdminSidebarProfile(user, {
    avatarImg: el.avatarImg,
    avatarFallback: el.avatarFallback,
    nameEl: el.nameEl
  });

  track(
    watchSupportMessages(
      (items) => {
        messages = items;
        renderStats();
        render();
        openFromQuery();
      },
      {
        onError: () =>
          showFeedback("Messages could not be loaded. Check your Firestore rules.")
      }
    )
  );
});

/* ---------- stats ---------- */

const lower = (v) => String(v || "").toLowerCase();

function renderStats() {
  setText("msg-total", messages.length.toLocaleString());
  setText("msg-new", messages.filter((m) => lower(m.status) === "new").length.toLocaleString());
  /* This counted status === "replied", so a thread you answered and
     then CLOSED stopped being counted as replied — the number went
     down as you tidied the inbox. Counting threads that actually hold
     a reply is the reading the database supports. */
  setText(
    "msg-replied",
    messages.filter((m) => m.replyCount > 0).length.toLocaleString()
  );
  setText("msg-members", messages.filter((m) => m.uid).length.toLocaleString());
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showFeedback(message) {
  el.feedback.textContent = message;
  el.feedback.hidden = false;
}

/* ---------- table ---------- */

function visible() {
  const term = (el.search?.value || "").toLowerCase();
  const filter = el.filter?.value || "all";
  return messages.filter((m) => {
    const matchesStatus = filter === "all" || lower(m.status) === filter;
    /* Widened. Searching could not find a message by its topic, by the
       phone number on it, by the order it was about, or by anything in
       a reply you had already sent. */
    const matchesTerm =
      !term ||
      [
        m.name, m.email, m.phone, m.message, m.ref, m.orderId,
        m.subject, TOPICS[m.subject],
        ...m.thread.map((r) => r.text)
      ].some((v) => String(v || "").toLowerCase().includes(term));
    return matchesStatus && matchesTerm;
  });
}

function render() {
  const rows = visible();

  if (!rows.length) {
    el.body.innerHTML = messages.length
      ? '<tr><td colspan="8" class="admin-empty">No messages match this filter.</td></tr>'
      : '<tr><td colspan="8" class="admin-empty">No support messages yet.</td></tr>';
    return;
  }

  el.body.innerHTML = rows
    .map(
      (m) => `<tr>
      <td><strong>#${escapeHtml(m.ref)}</strong></td>
      <td>${escapeHtml(m.name || "—")}<div class="admin-table-subtext">${escapeHtml(
        m.email
      )}${m.uid ? " · member" : ""}${
        m.phone ? ` · ${escapeHtml(m.phone)}` : ""
      }</div></td>
      <td>${escapeHtml(TOPICS[m.subject] || m.subject || "—")}${
        m.orderId
          ? `<div class="admin-table-subtext">order #${escapeHtml(m.orderId)}</div>`
          : ""
      }</td>
      <td><small>${escapeHtml(
        m.message.length > 90 ? `${m.message.slice(0, 90)}…` : m.message
      )}</small></td>
      <td>${escapeHtml(timeAgo(m.createdAt))}</td>
      <td>${
        /* ADDED. How many times you have answered, and when the last
           one went out. Both were already in the document. */
        m.replyCount
          ? `${m.replyCount}<div class="admin-table-subtext">${escapeHtml(
              timeAgo(m.repliedAt || m.createdAt)
            )}</div>`
          : '<span class="admin-table-subtext">—</span>'
      }</td>
      <td><span class="admin-product-status admin-product-status--${
        lower(m.status) === "new" ? "inactive" : "active"
      }">${escapeHtml(m.status)}</span></td>
      <td><div class="admin-product-actions">
        <button type="button" data-action="open" data-id="${m.id}">Open</button>
        ${
          lower(m.status) === "closed"
            ? `<button type="button" data-action="reopen" data-id="${m.id}">Reopen</button>`
            : `<button type="button" data-action="close" data-id="${m.id}">Close</button>`
        }
      </div></td>
    </tr>`
    )
    .join("");
}

el.search?.addEventListener("input", render);
el.filter?.addEventListener("change", render);

/* ---------- open / reply ---------- */

const when = (value) => {
  const d = toDate(value);
  return d ? d.toLocaleString("en-US") : "—";
};

/* A value out of a document the normalizer does not know about. It
   could be anything the contact form grows next, so it is printed
   rather than assumed to be a string. */
function showValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (value?.toDate) return when(value);
  if (Array.isArray(value)) return value.length ? value.map(showValue).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function openMessage(message) {
  active = message;
  el.modalTitle.textContent = `#${message.ref} · ${TOPICS[message.subject] || message.subject}`;

  const closed = lower(message.status) === "closed";

  el.modalBody.innerHTML = `
    <div class="order-info-grid">
      <p><small>From</small><strong>${escapeHtml(message.name || "—")}</strong></p>
      <p><small>Email</small>${escapeHtml(message.email || "—")}</p>
      ${
        /* ADDED. If the contact form collects a number it was being
           written to Firestore and never read back — you could not
           phone someone back from this page. */
        message.phone
          ? `<p><small>Phone</small>${escapeHtml(message.phone)}</p>`
          : ""
      }
      <p><small>Received</small>${escapeHtml(when(message.createdAt))}</p>
      <p><small>Topic</small>${escapeHtml(TOPICS[message.subject] || message.subject || "—")}</p>
      <p><small>Account</small>${
        message.uid ? "Signed-in member" : "Guest — reply by email"
      }</p>
      <p><small>Status</small>${escapeHtml(message.status)}</p>
      ${
        /* ADDED. Both of these have been written to every message since
           the page shipped and shown on none of them. */
        message.repliedAt
          ? `<p><small>Last replied</small>${escapeHtml(when(message.repliedAt))}</p>`
          : ""
      }
      ${
        message.updatedAt
          ? `<p><small>Last updated</small>${escapeHtml(when(message.updatedAt))}${
              message.updatedBy ? ` · ${escapeHtml(message.updatedBy)}` : ""
            }</p>`
          : ""
      }
      ${
        message.orderId
          ? `<p><small>About order</small><strong>#${escapeHtml(message.orderId)}</strong></p>`
          : ""
      }
    </div>

    <div class="order-special-request">
      <small>Message</small>
      <p>${escapeHtml(message.message)}</p>
    </div>

    ${
      /* The whole reply history, oldest first, each one stamped with
         who sent it. Previously only the single most recent reply was
         shown — and only the most recent one still existed. */
      message.thread.length
        ? `<p class="admin-form-subheading" style="margin-top:1rem">Replies (${
            message.thread.length
          })</p>
           ${message.thread
             .map(
               (r, i) => `<div class="order-special-request">
                 <small>${i + 1} of ${message.thread.length} · ${escapeHtml(
                 r.by || "an administrator"
               )} · ${escapeHtml(when(r.at))}</small>
                 <p>${escapeHtml(r.text)}</p>
               </div>`
             )
             .join("")}`
        : ""
    }

    ${
      /* Anything in the document this page has no column for. If the
         contact form starts writing a new field, it shows up here
         rather than sitting in Firestore unseen. */
      message.extras.length
        ? `<p class="admin-form-subheading" style="margin-top:1rem">Other fields on this record</p>
           <div class="order-info-grid">${message.extras
             .map(
               ([key, value]) =>
                 `<p><small>${escapeHtml(key)}</small>${escapeHtml(showValue(value))}</p>`
             )
             .join("")}</div>`
        : ""
    }

    <p class="admin-form-subheading" style="margin-top:1.1rem">Thread status</p>
    <select class="admin-text-input" id="support-status-select">
      ${["New", "Replied", "Closed"]
        .map(
          (s) =>
            `<option value="${s}"${lower(s) === lower(message.status) ? " selected" : ""}>${s}</option>`
        )
        .join("")}
    </select>
    <p class="admin-table-subtext" id="support-status-note" style="margin-top:.5rem">
      Closing a thread does not notify the customer. Replying does.
    </p>`;

  el.reply.value = "";

  /* The reply box used to stay fully armed on a CLOSED thread, and
     sending from there silently flipped it back to Replied with no
     indication that was about to happen. It is still possible — that
     is a legitimate way to reopen a thread — but it now says so. */
  const guest = !message.uid;
  el.replyNote.textContent = closed
    ? "This thread is closed — replying reopens it"
    : guest
    ? "Not delivered — email them"
    : "Goes to their notifications";
  el.replyNote.classList.toggle("admin-reply-hint--warn", guest || closed);

  el.modal.hidden = false;
  el.backdrop.hidden = false;

  document
    .getElementById("support-status-select")
    ?.addEventListener("change", async (event) => {
      const select = event.target;
      const note = document.getElementById("support-status-note");
      select.disabled = true;
      if (note) note.textContent = "Saving...";
      try {
        await updateMessageStatus(message.id, select.value, message.name || message.email || "");
        if (note) note.textContent = "Saved.";
      } catch (err) {
        console.error("Could not update message status:", err);
        select.value = message.status;
        if (note) note.textContent = "Could not save. Check your Firestore rules.";
      } finally {
        select.disabled = false;
      }
    });
}

function closeModal() {
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  active = null;
}

/* Arriving from the notification bell: admin-support.html?msg=<id>.
   Runs on the first snapshot only — the id is stripped from the URL
   straight after, so a refresh or a Back doesn't keep reopening the
   same message on top of whatever the admin moved on to. */
let handledQuery = false;

function openFromQuery() {
  if (handledQuery) return;
  const wanted = new URLSearchParams(window.location.search).get("msg");
  if (!wanted) {
    handledQuery = true;
    return;
  }

  const message = messages.find((m) => m.id === wanted);
  if (!message) return; // Wait for a snapshot that contains it.

  handledQuery = true;
  openMessage(message);
  window.history.replaceState({}, "", window.location.pathname);
}

el.body?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const message = messages.find((m) => m.id === button.dataset.id);
  if (!message) return;

  if (button.dataset.action === "open") {
    openMessage(message);
    return;
  }

  /* A closed thread used to be a dead end from the table: the Close
     button disappeared and nothing replaced it, so the only way back
     was to reply, which flipped it to Replied rather than reopening it.
     Reopen puts it back to New. */
  const next = button.dataset.action === "reopen" ? "New" : "Closed";

  try {
    await updateMessageStatus(message.id, next, message.name || message.email || "");
  } catch (err) {
    console.error(`Could not set message to ${next}:`, err);
    showFeedback("That could not be saved. Check your Firestore rules.");
  }
});

document.getElementById("support-modal-close")?.addEventListener("click", closeModal);
document.getElementById("support-modal-cancel")?.addEventListener("click", closeModal);
el.backdrop?.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modal.hidden) closeModal();
});

el.form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!active) return;

  const submit = el.form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Sending...";

  try {
    /* Re-resolve from the live snapshot rather than trusting the copy
       captured when the modal opened. replyToMessage appends to the
       thread it is handed, so replying against a stale copy would drop
       any reply that landed in between — which is exactly the bug the
       array was introduced to fix. */
    const fresh = messages.find((m) => m.id === active.id) || active;
    await replyToMessage(fresh, el.reply.value.trim());
    closeModal();
  } catch (err) {
    console.error("Reply failed:", err);
    showFeedback("The reply could not be saved. Check your Firestore rules.");
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Send reply <span aria-hidden="true">›</span>';
  }
});