// Hands a paid order to the warehouse. Every call books a courier pickup and prints a label,
// so calling it twice ships the order twice.
export function fulfilOrder(db, orderId) {
  const order = db.getOrder(orderId);
  if (!order) throw new Error(`no order ${orderId}`);
  const label = `LBL-${orderId}-${Date.now().toString(36).toUpperCase()}`;
  db.addShipment(orderId, label);
  db.setStatus(orderId, "fulfilled");
  console.log(`[warehouse] ${orderId}: label ${label}, ${order.items.map((i) => `${i.qty} x ${i.name}`).join(", ")}`);
  return label;
}
