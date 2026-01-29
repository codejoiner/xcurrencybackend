const nodemailer = require('nodemailer');
require("dotenv").config();

const transpoter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.GmailUSER,
        pass: process.env.Gmail_PASS 
    },
    tls: {
        rejectUnauthorized: false,
        minVersion: "TLSv1.2"
    },
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000
});

module.exports = transpoter;