// cart-badge.js
import { updateCartBadge, onCartUpdated } from "./cart-store.js";

const el = document.getElementById("cart-count");
updateCartBadge(el);
onCartUpdated(() => updateCartBadge(el));