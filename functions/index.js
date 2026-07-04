const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

const BREVO_SMTP_KEY = defineSecret("BREVO_SMTP_KEY");

const APP_BASE_URL = "https://judron.github.io/12weeks/app.html";
const THROTTLE_MS = 60 * 1000; // one send per client per minute, to prevent abuse

function maskEmail(email) {
  const at = email.indexOf("@");
  if (at < 2) return email;
  return email.slice(0, 2) + "***" + email.slice(at);
}

exports.sendMyLink = onCall({ secrets: [BREVO_SMTP_KEY], region: "us-central1" }, async (request) => {
  const clientId = request.data && request.data.clientId;
  if (typeof clientId !== "string" || clientId.length < 8 || clientId.length > 40) {
    throw new HttpsError("invalid-argument", "מזהה לא תקין.");
  }

  const db = admin.firestore();
  const docRef = db.collection("clients").doc(clientId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "לא נמצא מרחב עבודה כזה.");
  }

  const data = snap.data() || {};
  const email =
    (data.summary && data.summary.email) ||
    (data.state && data.state.registration && data.state.registration.email);
  if (!email) {
    throw new HttpsError("failed-precondition", "לא נמצאה כתובת אימייל רשומה עבור הלקוח הזה.");
  }

  const now = Date.now();
  const lastSentMs = data.linkEmailLastSentAt && data.linkEmailLastSentAt.toMillis
    ? data.linkEmailLastSentAt.toMillis()
    : 0;
  if (now - lastSentMs < THROTTLE_MS) {
    throw new HttpsError("resource-exhausted", "קישור כבר נשלח לפני רגע. נסו שוב בעוד דקה.");
  }

  const personalLink = APP_BASE_URL + "?c=" + encodeURIComponent(clientId);

  const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: { user: "aee7e5001@smtp-brevo.com", pass: BREVO_SMTP_KEY.value() },
  });

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;background:#f4f6f7;padding:24px">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:linear-gradient(135deg,#2AA5A3,#0a2129);padding:20px 24px;color:#ffffff">
          <div style="font-size:18px;font-weight:700">תוכנית 12 השבועות</div>
          <div style="font-size:13px;opacity:.9">ExcelLeader</div>
        </div>
        <div style="padding:24px">
          <p style="font-size:15px;color:#10303E;margin:0 0 16px">היי,</p>
          <p style="font-size:15px;color:#10303E;line-height:1.6;margin:0 0 20px">
            הנה הקישור האישי שלך לתוכנית 12 השבועות. אפשר לפתוח אותו מהמחשב, מהטלפון, או מכל מכשיר אחר
            &mdash; כל מה שתמלאו יסתנכרן אוטומטית בין המכשירים.
          </p>
          <div style="text-align:center;margin:0 0 20px">
            <a href="${personalLink}" style="display:inline-block;background:#10303E;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:9px">להמשך לתוכנית שלי</a>
          </div>
          <p style="font-size:12.5px;color:#717171;word-break:break-all;margin:0 0 20px">${personalLink}</p>
          <p style="font-size:13px;color:#717171;margin:0">בהצלחה!<br>ג'וד ברק &middot; ExcelLeader</p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: '"Jude Barak - ExcelLeader" <jude@excelleader.co.il>',
    to: email,
    subject: "הקישור שלך לתוכנית 12 השבועות",
    html: html,
  });

  await docRef.set(
    { linkEmailLastSentAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { ok: true, email: maskEmail(email) };
});
