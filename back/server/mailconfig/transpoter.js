const nodemailer = require('nodemailer');

require("dotenv").config();
const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.BREVO_USER,
        pass: process.env.BREVO_PASS 
    }
});

module.exports = transporter;