import nodemailer from "nodemailer";
// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn(
    "EMAIL_USER/EMAIL_PASS not set. OTP emails will fail until configured."
  );
}

export { transporter };
