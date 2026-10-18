/* ==========================================================
   Trailbound — where uploaded images go
   ----------------------------------------------------------
   The ONE file you edit to turn image uploads on. Nothing else
   in the project needs to change, and no page imports a host's
   name directly — they all call uploadImage() and get a URL
   back, exactly as they did with Firebase Storage.

   Pick a provider, paste one or two values, reload the admin
   page. The URL that comes back is stored on the product or
   trail record in the same field a pasted URL goes in, so the
   shop cannot tell the difference and nothing downstream has
   to care.

   ----------------------------------------------------------
   OPTION 1 — imgbb   (free, no card, about two minutes)

     1. Sign up at https://imgbb.com
     2. Open https://api.imgbb.com → "Get API key"
     3. Paste it into imgbb.apiKey below
     4. Set provider to "imgbb"

   ----------------------------------------------------------
   OPTION 2 — Cloudinary   (free tier, also no card)

     1. Sign up at https://cloudinary.com
     2. Dashboard → copy your "Cloud name"
     3. Settings → Upload → Upload presets → add a preset and
        set its signing mode to UNSIGNED. Copy its name.
     4. Paste both below and set provider to "cloudinary"

   ----------------------------------------------------------
   OPTION 3 — "firebase"

     The original path. It needs Cloud Storage enabled on the
     Firebase project, which currently requires the Blaze plan.

   ----------------------------------------------------------
   A WORD ABOUT THE KEY, because this file goes to GitHub.

   Anything in this file ships to the browser and is readable by
   anyone who opens your site — that is true of every front-end
   key, including the Firebase apiKey already in
   firebase-init.js. It is not a password and it cannot read
   your account.

   What someone could do with the imgbb key is upload images to
   your account and burn your quota. If that ever happens, go to
   https://api.imgbb.com and regenerate the key, then paste the
   new one here. Cloudinary's unsigned preset is designed for
   exactly this use and can be revoked the same way.

   If you would rather it not sit in the repo at all, the real
   fix is a small server endpoint that holds the key and proxies
   the upload — more than this project needs today, but that is
   the direction if it ever goes properly live.
   ========================================================== */

export const IMAGE_UPLOAD = {
  /* "imgbb" | "cloudinary" | "firebase" | "off"
     "off" disables uploading and leaves the URL boxes working,
     which is also what happens automatically if the values for
     the chosen provider are missing. */
  provider: "imgbb",

  imgbb: {
    apiKey: ""            // <-- API key
  },

  cloudinary: {
    cloudName: "",        // <-- e.g. "dxxxxxxxx"
    uploadPreset: ""      // <-- the UNSIGNED preset's name
  },

  /* Shrink before uploading. A 12-megapixel phone photo is ~6 MB
     and no bigger on screen than a 1600px one; sending the
     original wastes the uploader's data and slows every shop
     visitor's page load afterwards.

     maxWidth   longest edge, in pixels, after resizing
     quality    JPEG quality, 0-1
     minBytes   files smaller than this are sent untouched —
                re-encoding a small image only makes it worse */
  resize: {
    enabled: true,
    maxWidth: 1600,
    quality: 0.82,
    minBytes: 300 * 1024
  }
};
