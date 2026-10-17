// sms.js - sends the "your laundry is ready" text.
// Right now it only prints the message in the terminal (every SMS is also saved
// in the sms_log table). To send real texts, sign up with a Philippine SMS
// gateway (for example Semaphore), put its API key in .env, and replace the
// body of sendSms with that gateway's API call.
async function sendSms(phone, message) {
  console.log(`[SMS to ${phone}] ${message}`);
  return true;
}

module.exports = { sendSms };
