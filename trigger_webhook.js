const crypto = require('crypto');

async function trigger() {
  const secret = 'whs_287718e198af8bab3dd99b81abb55254bc872d7ab5d591f3';
  const apiKey = 'gs_live_8a5ac0500c2aadd83822aea9a475eb7c6317ea3a';

  const payload = {
    event: 'order.placed',
    data: {
      order_id: 77,
      user_id: 3,
      total: 1.5,
      payment_method: "unknown",
      items: [],
      customer_name: "Shahid Mohammad",
      phone: "8825041655",
      email: "shahidmohd533@gmail.com"
    }
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyString = JSON.stringify(payload);

  const signature = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');

  const res = await fetch('https://wacrm-wbjb.onrender.com/api/integration/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GilafStore-Key': apiKey,
      'X-GilafStore-Signature': signature,
      'X-GilafStore-Timestamp': timestamp
    },
    body: bodyString
  });

  const text = await res.text();
  console.log(res.status, text);
}

trigger().catch(console.error);
