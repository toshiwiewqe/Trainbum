/* ==========================================================
   Accommodation options for the booking page (Step 03).
   Edit THIS file to change prices or add partner hotels; the
   booking page picks the changes up automatically.

   BASECAMP  Trailbound's own stay, offered on every trail.
             Priced per person, per night.

   HOTELS    Partner hotels near the trails. A hotel shows up only
             for trails whose location or name contains one of its
             `areas` (e.g. areas: ["Benguet"] → every Benguet trail).
             You can also pin a hotel to exact trails with
             trail_ids: ["T001"].
             `address` is what Google Maps searches for, so keep it
             as the hotel's real address.
             Priced per room, per night; `sleeps` is people per room,
             so a group of 5 in rooms that sleep 2 books 3 rooms.

   The places and addresses below are real. The RATES are sample
   partner rates for the project — confirm or replace them with
   each hotel's actual prices.
   ========================================================== */

export const BASECAMP = {
  name: "Trailbound Basecamp",
  tagline: "Our own camp at the jump-off",
  price_per_person: 650,
  includes: [
    "Tent or bunk bed",
    "Dinner and breakfast",
    "Pre-dawn wake-up call",
    "Gear storage while you climb",
  ],
};

export const HOTELS = [
  // ---- Mt. Pulag / Benguet ----
  {
    id: "smr-homestay",
    name: "Mt. Pulag SMR Homestay",
    address: "Babadak, Kabayan, Benguet 2606",
    areas: ["Benguet", "Pulag"],
    distance: "Near the Babadak ranger station",
    price_per_room: 1500,
    sleeps: 4,
  },
  {
    id: "babans-homestay",
    name: "Mt. Pulag Baban's Homestay",
    address: "Babalak Bashoy, Kabayan, Benguet 2606",
    areas: ["Benguet", "Pulag"],
    distance: "Kabayan, Mt. Pulag area",
    price_per_room: 1800,
    sleeps: 4,
  },

  // ---- Mt. Batulao / Batangas ----
  {
    id: "evercrest-batulao",
    name: "Evercrest Golf Club Resort",
    address: "Batulao, Nasugbu, Batangas",
    areas: ["Batangas", "Batulao"],
    distance: "In Batulao, Nasugbu",
    price_per_room: 3800,
    sleeps: 2,
  },
  {
    id: "canyon-woods",
    name: "Miguel's Place at Canyon Woods Resort",
    address: "Diokno Highway, Brgy. San Gregorio, Laurel, Batangas 4221",
    areas: ["Batangas", "Batulao"],
    distance: "About 13 km from Mt. Batulao",
    price_per_room: 3200,
    sleeps: 2,
  },
];
