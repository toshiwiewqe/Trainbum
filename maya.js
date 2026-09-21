/* ==========================================================
   Trailbound — Maya Checkout (Sandbox)
   Sends the order to Maya and gets back a payment link.
   The customer then pays on Maya's own page (test cards only).
   ========================================================== */

// Your PUBLIC key from Maya Business Manager -> Applications.
// Only the pk- key goes here. NEVER put the sk- (secret) key in website code.
const MAYA_PUBLIC_KEY = "pk-tbbOhMWZ5F3FjOzrVoboH1m80H0mERizaKIXdM0fOwE";

// Sandbox = test mode. No real money.
const MAYA_CHECKOUT_URL = "https://pg-sandbox.paymaya.com/checkout/v1/checkouts";

/**
 * Creates a Maya checkout and returns { checkoutId, redirectUrl }.
 * @param {string} orderId      Firestore order id (used as the reference number)
 * @param {number} total        Order total in pesos
 * @param {Array}  mayaItems    [{ name, quantity, amount, totalAmount }]
 */
export async function createMayaCheckout(orderId, total, mayaItems) {
  // Where Maya sends the customer back after paying.
  // window.location.origin = your site, e.g. https://trailbound-app.web.app
  const resultPage = `${window.location.origin}/payment-result.html?order=${orderId}`;

  const body = {
    totalAmount: { value: total, currency: "PHP" },
    requestReferenceNumber: orderId,
    items: mayaItems.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      amount: { value: item.amount },
      totalAmount: { value: item.totalAmount },
    })),
    redirectUrl: {
      success: `${resultPage}&status=success`,
      failure: `${resultPage}&status=failed`,
      cancel: `${resultPage}&status=cancelled`,
    },
  };

  const response = await fetch(MAYA_CHECKOUT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Maya wants: "Basic " + base64("publicKey:")
      Authorization: "Basic " + btoa(MAYA_PUBLIC_KEY + ":"),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok || !data.redirectUrl) {
    console.error("Maya error:", data);
    throw new Error(data.message || "Maya could not create the checkout.");
  }

  return { checkoutId: data.checkoutId, redirectUrl: data.redirectUrl };
}
