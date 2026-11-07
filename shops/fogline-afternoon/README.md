# Fogline Supply Co. (afternoon PayPal checkout)

**A test fixture with deliberate bugs.** Same as `shops/fogline-naive`, except that amounts are sent to PayPal in
dollars, so a real purchase goes through and every attack has something to hit. The planted mistakes:

- the server accepts an `amount` and `currency` from the browser;
- the order is marked paid and shipped whatever the capture returned (declined captures included);
- the webhook route trusts any request, treats `CHECKOUT.ORDER.APPROVED` as payment, and ships on every delivery.

Do not copy this code. See `shops/fogline-express` for the card-only original.
