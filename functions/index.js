const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const crypto = require('crypto');
const Razorpay = require('razorpay');

initializeApp();

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');

// Creates a Razorpay order and returns the order_id to the client.
// The client passes order_id to the Razorpay checkout widget.
exports.createOrder = onCall(
  { secrets: [razorpayKeyId, razorpayKeySecret] },
  async () => {
    const rp = new Razorpay({
      key_id: razorpayKeyId.value(),
      key_secret: razorpayKeySecret.value(),
    });
    const order = await rp.orders.create({
      amount: 9900,
      currency: 'INR',
      receipt: `score_${Date.now()}`,
    });
    return { orderId: order.id };
  }
);

// Verifies the Razorpay HMAC signature then writes to the leaderboard.
// The client cannot write to /leaderboard directly (blocked by DB rules).
exports.verifyAndSaveScore = onCall(
  { secrets: [razorpayKeySecret] },
  async (request) => {
    const { orderId, paymentId, signature, name, time } = request.data;

    if (!orderId || !paymentId || !signature || !name?.trim() || typeof time !== 'number') {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const expected = crypto
      .createHmac('sha256', razorpayKeySecret.value())
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (expected !== signature) {
      throw new HttpsError('permission-denied', 'Invalid payment signature');
    }

    await getDatabase().ref('leaderboard').push({
      name: name.trim(),
      time,
      completedAt: Date.now(),
      paymentId,
    });

    return { success: true };
  }
);
