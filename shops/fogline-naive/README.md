# Fogline Supply Co. (naive PayPal checkout)

**A test fixture with deliberate bugs.** This is the Fogline shop with a PayPal checkout written the quick way, so
Heistproof has something to catch and fix. The mistakes are planted on purpose; they are well-known checkout bugs, not a measure of how common each one is:

- the amount is sent to PayPal in cents, so a $49.00 bag becomes a $4,900.00 PayPal order;
- the server accepts an `amount` and `currency` from the browser;
- the order is marked paid and shipped whatever the capture returned (declined captures included);
- the webhook route trusts any request, treats `CHECKOUT.ORDER.APPROVED` as payment, and ships on every delivery.

Do not copy this code. See `shops/fogline-express` for the card-only original.
