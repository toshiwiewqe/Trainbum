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
  order: "Order / gear",
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
  setText(
    "msg-replied",
    messages.filter((m) => lower(m.status) === "replied").length.toLocaleString()
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
    const matchesTerm =
      !term ||
      [m.name, m.email, m.message, m.ref].some((v) =>
        String(v || "").toLowerCase().includes(term)
      );
    return matchesStatus && matchesTerm;
  });
}

function render() {
  const rows = visible();

  if (!rows.length) {
    el.body.innerHTML = messages.length
      ? '<tr><td colspan="7" class="admin-empty">No messages match this filter.</td></tr>'
      : '<tr><td colspan="7" class="admin-empty">No support messages yet.</td></tr>';
    return;
  }

  el.body.innerHTML = rows
    .map(
      (m) => `<tr>
      <td><strong>#${escapeHtml(m.ref)}</strong></td>
      <td>${escapeHtml(m.name || "—")}<div class="admin-table-subtext">${escapeHtml(
        m.email
      )}${m.uid ? " · member" : ""}</div></td>
      <td>${escapeHtml(TOPICS[m.subject] || m.subject || "—")}</td>
      <td><small>${escapeHtml(
        m.message.length > 90 ? `${m.message.slice(0, 90)}…` : m.message
      )}</small></td>
      <td>${escapeHtml(timeAgo(m.createdAt))}</td>
      <td><span class="admin-product-status admin-product-status--${
        lower(m.status) === "new" ? "inactive" : "active"
      }">${escapeHtml(m.status)}</span></td>
      <td><div class="admin-product-actions">
        <button type="button" data-action="open" data-id="${m.id}">Open</button>
        ${
          lower(m.status) === "closed"
            ? ""
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

function openMessage(message) {
  active = message;
  el.modalTitle.textContent = `#${message.ref} · ${TOPICS[message.subject] || message.subject}`;

  const received = toDate(message.createdAt);

  el.modalBody.innerHTML = `
    <div class="order-info-grid">
      <p><small>From</small><strong>${escapeHtml(message.name || "—")}</strong></p>
      <p><small>Email</small>${escapeHtml(message.email || "—")}</p>
      <p><small>Received</small>${escapeHtml(
        received ? received.toLocaleString("en-US") : "—"
      )}</p>
      <p><small>Account</small>${
        message.uid ? "Signed-in member" : "Guest — reply by email"
      }</p>
    </div>
    <div class="order-special-request">
      <small>Message</small>
      <p>${escapeHtml(message.message)}</p>
    </div>
    ${
      message._raw.reply
        ? `<div class="order-special-request"><small>Your previous reply</small><p>${escapeHtml(
            message._raw.reply
          )}</p></div>`
        : ""
    }`;

  el.reply.value = "";

  // This used to be a three-line paragraph wedged between the textarea
  // and the buttons. Everything it said is already on the card above —
  // the Account row says "Guest — reply by email", the Email row gives
  // the address — so it is a short tag beside the Reply label now.
  const guest = !message.uid;
  el.replyNote.textContent = guest ? "Not delivered — email them" : "Goes to their notifications";
  el.replyNote.classList.toggle("admin-reply-hint--warn", guest);

  el.modal.hidden = false;
  el.backdrop.hidden = false;
}

function closeModal() {
  el.modal.hidden = true;
  el.backdrop.hidden = true;
  active = null;
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

  try {
    await updateMessageStatus(message.id, "Closed", message.name || message.email || "");
  } catch (err) {
    console.error("Could not close message:", err);
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
    await replyToMessage(active, el.reply.value.trim());
    closeModal();
  } catch (err) {
    console.error("Reply failed:", err);
    showFeedback("The reply could not be saved. Check your Firestore rules.");
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Send reply <span aria-hidden="true">›</span>';
  }
});