const nodemailer=require('nodemailer')
require("dotenv").config();
const transpoter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GmailUSER,
        pass: process.env.Gmail_PASS 
    },
    tls: {
        rejectUnauthorized: false     },
    connectionTimeout: 30000 
});



module.exports=transpoter