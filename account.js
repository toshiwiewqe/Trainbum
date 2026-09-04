import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  deleteDoc,
  addDoc,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---- Element refs ----
const avatarImg         = document.getElementById('account-avatar');
const avatarFallback    = document.getElementById('account-avatar-fallback');
const nameEl            = document.getElementById('account-name');
const emailEl            = document.getElementById('account-email');
const memberSinceEl     = document.getElementById('account-member-since');
const nameInput         = document.getElementById('display-name-input');
const saveNameBtn       = document.getElementById('save-name-btn');
const phoneInput        = document.getElementById('phone-input');
const savePhoneBtn      = document.getElementById('save-phone-btn');
const profileFeedbackEl = document.getElementById('profile-feedback');
const logoutBtn         = document.getElementById('logout-btn');
const bookingsBtn       = document.getElementById('menu-bookings-btn');
const notifBadge        = document.getElementById('notif-badge');

const addressForm        = document.getElementById('address-form');
const billingSameCheck   = document.getElementById('billing-same-check');
const billingFields      = document.getElementById('billing-fields');
const addressFeedbackEl  = document.getElementById('address-feedback');

const wishlistListEl      = document.getElementById('wishlist-list');
const notificationsListEl = document.getElementById('notifications-list');

const menuView   = document.getElementById('account-menu');
const detailView = document.getElementById('account-detail');
const backBtn    = document.getElementById('back-btn');
const menuRows   = document.querySelectorAll('.account-menu-row[data-tab]');
const panels = {
  profile: document.getElementById('panel-profile'),
  addresses: document.getElementById('panel-addresses'),
  wishlist: document.getElementById('panel-wishlist'),
  notifications: document.getElementById('panel-notifications')
};

// ---- Menu <-> Detail navigation ----
menuRows.forEach(row => {
  row.addEventListener('click', () => {
    Object.values(panels).forEach(p => p.hidden = true);
    panels[row.dataset.tab].hidden = false;
    menuView.hidden = true;
    detailView.hidden = false;
  });
});

backBtn.addEventListener('click', () => {
  detailView.hidden = true;
  menuView.hidden = false;
});

bookingsBtn.addEventListener('click', () => {
  window.location.href = 'booking.html';
});

billingSameCheck?.addEventListener('change', () => {
  billingFields.hidden = billingSameCheck.checked;
});

let currentUser = null;

function getInitials(name, email) {
  const source = name || email || '?';
  return source.trim().charAt(0).toUpperCase();
}

function userDocRef(uid) {
  return doc(db, 'users', uid);
}

// Creates the Firestore user profile document on first login,
// and seeds a welcome notification. Returns the profile data.
async function ensureUserDoc(user) {
  const ref = userDocRef(user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName || '',
      email: user.email || '',
      phone: '',
      createdAt: serverTimestamp()
    });
    await addNotification(user.uid, {
      title: 'Welcome to Trailbound!',
      message: 'Your account has been created. Start exploring trails and save your favorites.',
      type: 'info'
    });
    return {};
  }
  return snap.data();
}

function renderUser(user, profileData) {
  const displayName = user.displayName || 'Trailbound Hiker';

  nameEl.textContent = displayName;
  emailEl.textContent = user.email || '';
  nameInput.value = user.displayName || '';
  phoneInput.value = profileData?.phone || '';

  if (user.metadata?.creationTime) {
    const date = new Date(user.metadata.creationTime);
    memberSinceEl.textContent = 'Member since ' + date.toLocaleDateString('en-US', {
      month: 'long', year: 'numeric'
    });
  }

  if (user.photoURL) {
    avatarImg.src = user.photoURL;
    avatarImg.hidden = false;
    avatarFallback.hidden = true;
  } else {
    avatarImg.hidden = true;
    avatarFallback.hidden = false;
    avatarFallback.textContent = getInitials(user.displayName, user.email);
  }
}

function fillAddressForm(profileData) {
  const ship = profileData?.shippingAddress || {};
  document.getElementById('ship-line1').value = ship.line1 || '';
  document.getElementById('ship-line2').value = ship.line2 || '';
  document.getElementById('ship-city').value = ship.city || '';
  document.getElementById('ship-province').value = ship.province || '';
  document.getElementById('ship-postal').value = ship.postalCode || '';
  document.getElementById('ship-country').value = ship.country || 'Philippines';

  const sameAsShipping = profileData?.billingSameAsShipping !== false;
  billingSameCheck.checked = sameAsShipping;
  billingFields.hidden = sameAsShipping;

  const bill = profileData?.billingAddress || {};
  document.getElementById('bill-line1').value = bill.line1 || '';
  document.getElementById('bill-line2').value = bill.line2 || '';
  document.getElementById('bill-city').value = bill.city || '';
  document.getElementById('bill-province').value = bill.province || '';
  document.getElementById('bill-postal').value = bill.postalCode || '';
  document.getElementById('bill-country').value = bill.country || 'Philippines';
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;

  const profileData = await ensureUserDoc(user);
  renderUser(user, profileData);
  fillAddressForm(profileData);
  loadWishlist(user.uid);
  loadNotifications(user.uid);
});

// ---- Profile: display name ----
saveNameBtn.addEventListener('click', async () => {
  const newName = nameInput.value.trim();
  if (!newName) {
    showFeedback(profileFeedbackEl, 'Display name cannot be empty.', true);
    return;
  }

  saveNameBtn.disabled = true;
  saveNameBtn.textContent = 'Saving...';

  try {
    await updateProfile(auth.currentUser, { displayName: newName });
    await updateDoc(userDocRef(currentUser.uid), { displayName: newName });
    nameEl.textContent = newName;
    avatarFallback.textContent = getInitials(newName, auth.currentUser.email);
    showFeedback(profileFeedbackEl, 'Saved!', false);
  } catch (err) {
    console.error('Profile update error:', err);
    showFeedback(profileFeedbackEl, 'Could not save changes. Try again.', true);
  } finally {
    saveNameBtn.disabled = false;
    saveNameBtn.textContent = 'Save';
  }
});

// ---- Profile: phone ----
savePhoneBtn.addEventListener('click', async () => {
  savePhoneBtn.disabled = true;
  savePhoneBtn.textContent = 'Saving...';

  try {
    await updateDoc(userDocRef(currentUser.uid), { phone: phoneInput.value.trim() });
    showFeedback(profileFeedbackEl, 'Saved!', false);
  } catch (err) {
    console.error('Phone update error:', err);
    showFeedback(profileFeedbackEl, 'Could not save phone number.', true);
  } finally {
    savePhoneBtn.disabled = false;
    savePhoneBtn.textContent = 'Save';
  }
});

// ---- Addresses ----
addressForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const shippingAddress = {
    line1: document.getElementById('ship-line1').value.trim(),
    line2: document.getElementById('ship-line2').value.trim(),
    city: document.getElementById('ship-city').value.trim(),
    province: document.getElementById('ship-province').value.trim(),
    postalCode: document.getElementById('ship-postal').value.trim(),
    country: document.getElementById('ship-country').value.trim()
  };

  const billingSameAsShipping = billingSameCheck.checked;

  const billingAddress = billingSameAsShipping
    ? shippingAddress
    : {
        line1: document.getElementById('bill-line1').value.trim(),
        line2: document.getElementById('bill-line2').value.trim(),
        city: document.getElementById('bill-city').value.trim(),
        province: document.getElementById('bill-province').value.trim(),
        postalCode: document.getElementById('bill-postal').value.trim(),
        country: document.getElementById('bill-country').value.trim()
      };

  const submitBtn = addressForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    await updateDoc(userDocRef(currentUser.uid), {
      shippingAddress,
      billingSameAsShipping,
      billingAddress
    });
    showFeedback(addressFeedbackEl, 'Addresses saved!', false);
  } catch (err) {
    console.error('Address save error:', err);
    showFeedback(addressFeedbackEl, 'Could not save addresses. Try again.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save addresses';
  }
});

// ---- Wishlist ----
async function loadWishlist(uid) {
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'wishlist'));

    if (snap.empty) {
      wishlistListEl.innerHTML = '<p class="account-empty">Your wishlist is empty. Save trails you love to see them here.</p>';
      return;
    }

    wishlistListEl.innerHTML = '';
    snap.forEach(docSnap => {
      const item = docSnap.data();
      const card = document.createElement('div');
      card.className = 'wishlist-item';
      card.innerHTML = `
        <img src="${item.image || ''}" alt="${item.name || ''}" class="wishlist-item-img">
        <div class="wishlist-item-info">
          <p class="wishlist-item-name">${item.name || 'Untitled item'}</p>
          ${item.price ? `<p class="wishlist-item-price">₱${item.price}</p>` : ''}
        </div>
        <button class="wishlist-remove-btn" data-id="${docSnap.id}" type="button">Remove</button>
      `;
      wishlistListEl.appendChild(card);
    });

    wishlistListEl.querySelectorAll('.wishlist-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await deleteDoc(doc(db, 'users', uid, 'wishlist', btn.dataset.id));
        loadWishlist(uid);
      });
    });
  } catch (err) {
    console.error('Wishlist load error:', err);
    wishlistListEl.innerHTML = '<p class="account-empty">Could not load wishlist.</p>';
  }
}

// Exposed globally so trail/product cards elsewhere on the site can call this,
// e.g. onclick="addToWishlist({ name: 'Mt Pulag', image: '...', price: 800 })"
window.addToWishlist = async function (item) {
  if (!currentUser) {
    alert('Please log in to save items to your wishlist.');
    return;
  }
  await addDoc(collection(db, 'users', currentUser.uid, 'wishlist'), {
    name: item.name,
    image: item.image || '',
    price: item.price || null,
    addedAt: serverTimestamp()
  });
};

// ---- Notifications ----
async function addNotification(uid, { title, message, type }) {
  await addDoc(collection(db, 'users', uid, 'notifications'), {
    title,
    message,
    type: type || 'info',
    read: false,
    createdAt: serverTimestamp()
  });
}
// Exposed globally so other pages (e.g. booking.js on order status change)
// can call: addNotification(uid, { title, message, type })
window.addNotification = addNotification;

async function loadNotifications(uid) {
  try {
    const q = query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    const unreadCount = snap.docs.filter(d => !d.data().read).length;
    if (unreadCount > 0) {
      notifBadge.textContent = unreadCount;
      notifBadge.hidden = false;
    } else {
      notifBadge.hidden = true;
    }

    if (snap.empty) {
      notificationsListEl.innerHTML = '<p class="account-empty">No notifications yet.</p>';
      return;
    }

    notificationsListEl.innerHTML = '';
    snap.forEach(docSnap => {
      const n = docSnap.data();
      const item = document.createElement('div');
      item.className = 'notification-item' + (n.read ? '' : ' notification-item--unread');
      const date = n.createdAt?.toDate
        ? n.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      item.innerHTML = `
        <div class="notification-dot" aria-hidden="true"></div>
        <div class="notification-body">
          <p class="notification-title">${n.title}</p>
          <p class="notification-message">${n.message}</p>
          <p class="notification-date">${date}</p>
        </div>
        ${!n.read ? `<button class="notification-read-btn" data-id="${docSnap.id}" type="button">Mark read</button>` : ''}
      `;
      notificationsListEl.appendChild(item);
    });

    notificationsListEl.querySelectorAll('.notification-read-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateDoc(doc(db, 'users', uid, 'notifications', btn.dataset.id), { read: true });
        loadNotifications(uid);
      });
    });
  } catch (err) {
    console.error('Notifications load error:', err);
    notificationsListEl.innerHTML = '<p class="account-empty">Could not load notifications.</p>';
  }
}

function showFeedback(el, message, isError) {
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle('account-feedback--error', isError);
  setTimeout(() => { el.hidden = true; }, 2500);
}

logoutBtn.addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.href = 'index.html';
  } catch (err) {
    console.error('Sign out error:', err);
  }
});