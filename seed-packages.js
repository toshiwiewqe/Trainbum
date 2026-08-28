// seed-packages.js
// ONE-TIME SCRIPT: pushes package data into Firestore.
// Run once via seed-packages.html, confirm in Firebase console,
// then delete both files.

import { db } from "./firebase-config.js";
import { doc, setDoc } from "firebase/firestore";

const packages = [
  {
    package_id: "P001",
    name: "Basic Day Hike",
    price_per_pax: 1440,
    requires_activity_choice: false,
    requires_accommodation: false,
    includes: [
      "Tour Guide",
      "Barangay Registration/Certification",
      "Environmental Fee",
      "Trail/Entrance Fee",
      "Digital Itinerary",
    ],
  },
  {
    package_id: "P002",
    name: "Day Hike + Activity",
    price_per_pax: 1800,
    requires_activity_choice: true,
    requires_accommodation: false,
    includes: [
      "Everything in Basic Day Hike",
      "1 Selected Activity (Waterfall Stop or Tree Planting)",
    ],
  },
  {
    package_id: "P003",
    name: "Overnight Hike",
    price_per_pax: 2400,
    requires_activity_choice: true,
    requires_accommodation: true,
    includes: [
      "Everything in Day Hike + Activity",
      "1-Night Accommodation",
      "Overnight Itinerary",
    ],
  },
  {
    package_id: "P004",
    name: "Private Hike",
    price_per_pax: 3000,
    requires_activity_choice: false,
    requires_accommodation: false,
    includes: [
      "Private Tour Guide",
      "Basic Day Hike",
      "Personalized Itinerary",
    ],
  },
  {
    package_id: "P005",
    name: "Group Hike",
    price_per_pax: 4200,
    requires_activity_choice: true,
    requires_accommodation: false,
    includes: [
      "Group Tour Guide",
      "Day Hike + Activity",
      "1 Selected Activity (Waterfall Stop or Tree Planting)",
      "Group Itinerary",
    ],
  },
];

async function seedPackages() {
  for (const pkg of packages) {
    await setDoc(doc(db, "packages", pkg.package_id), pkg);
    console.log("Added package:", pkg.name);
  }
  console.log("✅ Done seeding packages!");
}

seedPackages();