/* ==========================================================
   Trailbound — Taxonomy
   Shared category tree, colors, and sizes.

   Used in TWO places:
   1. Browser: loaded as a classic <script> tag before products.js
        <script src="taxonomy.js"></script>
        <script type="module" src="products.js"></script>
      products.js reads CATEGORY_TREE / COLORS / SIZES as globals.

   2. Node: required by products-seed.js during the one-time
      Firestore seed:
        const { COLORS, SIZES } = require("./taxonomy.js");
   ========================================================== */

const CATEGORY_TREE = {
  "Camp Essentials": [
    "Tents",
    "Firewoods",
    "Hammocks",
    "Sleeping Bags",
    "Camping Chairs"
  ],
  "Storage": [
    "Bags",
    "Tumblers",
    "Lunchboxes",
    "Holsters",
    "Pouches"
  ],
  "Trail Essentials": [
    "Trekking Poles",
    "Flashlights/Headlamps",
    "Maps",
    "Tools",
    "First-Aid Kit"
  ],
  "Merchandise": {
    "Headwear": ["Helmets", "Caps", "Neck Gaiters", "Glasses", "Bandanas"],
    "Bodywear": ["Raincoats", "Jackets", "Shirts", "Vests", "Longsleeves"],
    "Bottomwear": ["Trousers", "Socks", "Boots", "Foot Gaiters", "Leggings"]
  }
};

const COLORS = [
  "Black",
  "Charcoal",
  "Stone",
  "Sand",
  "Olive",
  "Forest Green",
  "Navy",
  "Slate Blue",
  "Rust",
  "Burgundy"
];

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

/* Export for Node (seed script). In the browser this block is skipped,
   and CATEGORY_TREE / COLORS / SIZES remain as top-level globals that
   products.js can reference directly. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CATEGORY_TREE, COLORS, SIZES };
}
