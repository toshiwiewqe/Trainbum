/* ==========================================================
   Trailbound — Taxonomy
   Shared category tree, colors, and sizes.

   Used in TWO places:
   1. Browser: loaded as an ES module, imported by products.js
        <script type="module" src="taxonomy.js"></script>
        <script type="module" src="products.js"></script>
      products.js imports CATEGORY_TREE / COLORS / SIZES directly:
        import { CATEGORY_TREE, COLORS, SIZES } from "./taxonomy.js";

   2. Node: required by the seed script during the one-time
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

// Browser: proper ES module export — products.js imports these directly now.
export { CATEGORY_TREE, COLORS, SIZES };

/* Node (seed script): keep this working the same way as before, so
   require("./taxonomy.js") in your seed script still gets the same
   { CATEGORY_TREE, COLORS, SIZES } shape. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CATEGORY_TREE, COLORS, SIZES };
}