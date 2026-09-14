import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const productsRef = collection(db, 'products');
let products = [];

const elements = {
  list: document.getElementById('product-list'),
  search: document.getElementById('product-search'),
  statusFilter: document.getElementById('product-status-filter'),
  feedback: document.getElementById('product-feedback'),
  modal: document.getElementById('product-modal'),
  backdrop: document.getElementById('product-modal-backdrop'),
  form: document.getElementById('product-form')
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    returnToLogin();
    return;
  }
  const adminSnapshot = await getDoc(doc(db, 'admins', user.uid));
  if (!adminSnapshot.exists()) {
    await signOut(auth);
    returnToLogin();
    return;
  }
  document.getElementById('admin-name').textContent = user.displayName || user.email || 'Admin';
  if (user.photoURL) {
    const avatar = document.getElementById('admin-avatar');
    avatar.src = user.photoURL;
    avatar.hidden = false;
    document.getElementById('admin-avatar-fallback').hidden = true;
  } else {
    document.getElementById('admin-avatar-fallback').textContent = (user.displayName || user.email || 'A').charAt(0).toUpperCase();
  }
  loadProducts();
});

function returnToLogin() {
  window.location.href = 'admin-login.html';
}

async function loadProducts() {
  try {
    const snapshot = await getDocs(productsRef);
    products = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderProducts();
  } catch (error) {
    console.error('Product load failed:', error);
    showFeedback('Products could not be loaded. Check Firestore permissions.');
  }
}

function filteredProducts() {
  const term = elements.search.value.trim().toLowerCase();
  const status = elements.statusFilter.value;
  return products.filter((product) => {
    const matchesText = !term || [product.name, product.description, product.category].some((value) => String(value || '').toLowerCase().includes(term));
    const productStatus = String(product.status || 'active').toLowerCase();
    return matchesText && (status === 'all' || productStatus === status);
  });
}

function renderProducts() {
  const visibleProducts = filteredProducts();
  const activeProducts = products.filter((item) => String(item.status || 'active').toLowerCase() === 'active');
  const categories = new Set(products.map((item) => item.category).filter(Boolean));
  document.getElementById('product-total').textContent = products.length.toLocaleString();
  document.getElementById('product-active').textContent = activeProducts.length.toLocaleString();
  document.getElementById('product-value').textContent = '₱' + products.reduce((sum, item) => sum + (Number(item.price) || 0), 0).toLocaleString();
  document.getElementById('product-categories').textContent = categories.size.toLocaleString();

  if (!visibleProducts.length) {
    elements.list.innerHTML = '<tr><td colspan="6" class="admin-empty">No products match this filter.</td></tr>';
    return;
  }
  elements.list.innerHTML = visibleProducts.map((product) => {
    const status = String(product.status || 'active').toLowerCase();
    return `<tr>
      <td><img class="admin-product-thumb" src="${escapeHtml(product.image || '')}" alt=""></td>
      <td><strong>${escapeHtml(product.name || 'Untitled')}</strong><small>${escapeHtml(product.description || 'No description')}</small></td>
      <td>${escapeHtml(product.category || 'Uncategorized')}</td>
      <td>₱${Number(product.price || 0).toLocaleString()}</td>
      <td><span class="admin-product-status admin-product-status--${status}">${status}</span></td>
      <td><div class="admin-product-actions"><button type="button" data-action="toggle" data-id="${product.id}">${status === 'active' ? 'Disable' : 'Enable'}</button><button type="button" data-action="delete" data-id="${product.id}">Delete</button></div></td>
    </tr>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function showFeedback(message) {
  elements.feedback.textContent = message;
  elements.feedback.hidden = false;
}

function closeModal() {
  elements.modal.hidden = true;
  elements.backdrop.hidden = true;
  elements.form.reset();
}

elements.search.addEventListener('input', renderProducts);
elements.statusFilter.addEventListener('change', renderProducts);
document.getElementById('add-product-btn').addEventListener('click', () => {
  elements.modal.hidden = false;
  elements.backdrop.hidden = false;
});
document.getElementById('product-modal-close').addEventListener('click', closeModal);
document.getElementById('product-modal-cancel').addEventListener('click', closeModal);
elements.backdrop.addEventListener('click', closeModal);
document.getElementById('admin-logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  returnToLogin();
});

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = elements.form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await addDoc(productsRef, {
      name: document.getElementById('product-name').value.trim(),
      category: document.getElementById('product-category').value.trim(),
      description: document.getElementById('product-description').value.trim(),
      price: Number(document.getElementById('product-price').value),
      status: document.getElementById('product-status').value,
      image: document.getElementById('product-image').value.trim(),
      dateAdded: serverTimestamp()
    });
    closeModal();
    await loadProducts();
  } catch (error) {
    console.error('Product save failed:', error);
    showFeedback('Product could not be saved. Check Firestore permissions.');
  } finally {
    submit.disabled = false;
  }
});

elements.list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.id);
  if (!product) return;
  try {
    if (button.dataset.action === 'delete') {
      if (!window.confirm(`Delete ${product.name || 'this product'}?`)) return;
      await deleteDoc(doc(db, 'products', product.id));
    } else {
      await updateDoc(doc(db, 'products', product.id), { status: String(product.status || 'active').toLowerCase() === 'active' ? 'inactive' : 'active' });
    }
    await loadProducts();
  } catch (error) {
    console.error('Product update failed:', error);
    showFeedback('Product action failed. Check Firestore permissions.');
  }
});
