const axios = require("axios");
const crypto = require("crypto");
const bcrypt=require('bcrypt')
require("dotenv").config();

const pool = require("../connection/conn");
const nodecron=require('node-cron');
const {CreditDBwithnewBalance}=require('../credituser/creditsuser');
const transporter= require('../mailconfig/transpoter')
const { HttpsProxyAgent } = require('https-proxy-agent');
const proxyUrl = process.env.PROXY_URL; 
const agent = new HttpsProxyAgent(proxyUrl);
const speakeasy=require('speakeasy')


async function DepositAddress(req, res) {

  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Permission denied!" });
  }
  
  const uid = req.user.uid;
 

  try {
    const response = await axios.post(
      `${process.env.PAYNOW_API_URL}/v1/payment`,
      {
        price_amount:1, 
        price_currency: 'usd',
        pay_currency: "usdtbsc",
        order_id: uid.toString()
      },
      {
        headers: { 
          "x-api-key": process.env.APIKEY, 
          "Content-Type": "application/json"
        }
      }
    );

    const {payment_id, pay_address} = response.data;

    if(payment_id && pay_address){
     await pool.execute(`INSERT INTO pending_payments (userid, payment_id, pay_address)
       VALUES (?,?,?)`,[uid,payment_id,pay_address])
    }

    


    return res.status(200).json({
      address: pay_address,
     
    
    });

  } catch (err) {
    console.log('Error details:', err.response ? err.response.data : err.message);
    
    return res.status(500).json({ 
      message: "Unable to request address", 
      message: err.response ? err.response.data.message : err.message 
    });
  }
}


const PoolDeposit = async () => {
  const [pending] = await pool.execute(
    "SELECT * FROM pending_payments"
  );

  for (const d of pending) {
    try {
      const res = await axios.get(
        `${process.env.PAYNOW_API_URL}/v1/payment/${d.payment_id}`,
        { headers: { "x-api-key": process.env.APIKEY } }
      );

      const p = res.data;
      const userId = d.userid;
      
      const status = p.payment_status;
      const amount = p.actually_paid || 0;
      const [rows] = await pool.execute(
        "SELECT status, credited FROM deposits WHERE paymentid=?",
        [p.payment_id]
      );

      if (rows.length === 0) {
        await pool.execute(
          `INSERT INTO deposits 
           (user_id, paymentid, coin, paid_amount, status, credited)
           VALUES (?,?,?,?,?,0)`,
          [userId, p.payment_id, p.pay_currency, amount, status]
        );
      } else {
        await pool.execute(
          "UPDATE deposits SET status=?, paid_amount=? WHERE paymentid=?",
          [status, amount, p.payment_id]
        );

        const deposit = rows[0];

          if (status === "finished" && deposit.credited === 0) {
          await CreditDBwithnewBalance(amount, userId);
          await pool.execute(
            "UPDATE deposits SET credited=1 WHERE paymentid=?",
            [p.payment_id]
          );

          console.log("Deposit credited:", p.payment_id);

          await pool.execute(
            "DELETE FROM pending_payments WHERE payment_id=?",
            [p.payment_id]
          );
        }
      }

    } catch (err) {
      console.log("Error in polling deposit:", err.response?.data || err.message);
    }
  }
};


 

const Withdraw = async (req, res) => {
  const minamount = 1;
  const { uid } = req.user;

  const { amount, walletAddress } = req.body;

  const amountNumber = Number(amount);

  if (!uid) return res.status(401).json({ message: "Permission denied" });
  if (!amount || !walletAddress)
    return res.status(400).json({ message: "Missing fields" });

  if (isNaN(amountNumber)||amountNumber<minamount)
    return res.status(400).json({ message: "Invalid amount" });

  
  try {
    const [rows] = await pool.query(
      "SELECT amount FROM balance WHERE userid = ?",
      [uid]
    );

    if (!rows.length || amountNumber > rows[0].amount)
      return res.status(400).json({ message: "Insufficient funds" });

    await pool.query(
      "UPDATE balance SET amount = amount - ? WHERE userid = ?",
      [amountNumber, uid]
    );

    await pool.query(
      "INSERT INTO withdraw (user_id, amount, walletaddress) VALUES (?, ?, ?)",
      [uid, amountNumber, walletAddress]
    );

    return res.status(200).json({
      message: "Withdraw request saved. It will be processed soon."
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



 



const processWithdrawals = async () => {
  const [requests] = await pool.query(
    `SELECT withdraw_id, user_id, amount, walletaddress FROM withdraw WHERE status='pending'`
  );

  for (const req of requests) {
    let userRequestAmount = Number(req.amount);

    try {
     
      const authResponse = await axios.post(
        `${process.env.PAYNOW_API_URL}/v1/auth`,
        {
          email: process.env.NOWPAYMENTSEMAIL,
          password: process.env.NOWPAYMENTSPASSWORD
        },
        { httpsAgent: agent, proxy: false }
      );

      const jwtToken = authResponse.data.token;

    
      const balanceRes = await axios.get(`${process.env.PAYNOW_API_URL}/v1/balance`, {
        headers: {
          "Authorization": `Bearer ${jwtToken}`,
          "x-api-key": process.env.APIKEY,
          "Content-Type": "application/json"
        },
        httpsAgent: agent,
        proxy: false
      });

      const usdtData = balanceRes.data.usdtbsc || { amount: 0 };
      const nowpayamount = Number(usdtData.amount);

      if (nowpayamount < userRequestAmount) {
        console.log('amafaranga nimake')
        continue;
      }

      await pool.query(
        "UPDATE withdraw SET status = 'processing' WHERE withdraw_id = ?",
        [req.withdraw_id]
      );

     
      const payout = await axios.post(
        `${process.env.PAYNOW_API_URL}/v1/payout`,
        {
          withdrawals: [
            {
              address: req.walletaddress,
              currency: "usdtbsc",
              amount: userRequestAmount
            }
          ]
        },
        {
          headers: {
            "Authorization": `Bearer ${jwtToken}`,
            "x-api-key": process.env.APIKEY,
            "x-idempotency-key": req.withdraw_id.toString(),
            "Content-Type": "application/json"
          },
          httpsAgent: agent,
          proxy: false
        }
      );

      const payoutid = payout.data.id;

   
      await pool.query(
        "UPDATE withdraw SET payoutid=? WHERE withdraw_id = ?",
        [payoutid, req.withdraw_id]
      );

      
      const code = speakeasy.totp({
        secret: process.env.NOWPAYMENTS_2FA_SECRET,
        encoding: 'base32'
      });

      const verifyResponse = await axios.post(
        `${process.env.PAYNOW_API_URL}/v1/payout/${payoutid}/verify`,
        { verification_code: code },
        {
          headers: {
            "Authorization": `Bearer ${jwtToken}`,
            "x-api-key": process.env.APIKEY,
            "Content-Type": "application/json"
          },
          httpsAgent: agent,
          proxy: false
        }
      );

      console.log(`Success: Payout ${payoutid} verified and processing.`);

    } catch (error) {
      const errorMsg = error.response?.data || error.message;
      console.error(`Payout failed for ID ${req.withdraw_id}:`, errorMsg);

      await pool.query(
        "UPDATE withdraw SET status = 'failed' WHERE withdraw_id = ?",
        [req.withdraw_id]
      );

      await pool.query(
        "UPDATE balance SET amount = amount + ? WHERE userid = ?",
        [userRequestAmount, req.user_id]
      );
    }
  }
};

const trackeWithdrawstatus = async () => {
  try {
    const [withpayoutid] = await pool.execute(
      "SELECT user_id, withdraw_id, payoutid, amount FROM withdraw WHERE status = 'processing'"
    );
    
    if (withpayoutid.length === 0) return false;

    const authRes = await axios.post(`${process.env.PAYNOW_API_URL}/v1/auth`, {
      email: process.env.NOWPAYMENTSEMAIL,
      password: process.env.NOWPAYMENTSPASSWORD
    });
    
    const jwtToken = authRes.data.token;

    for (let payid of withpayoutid) {
      const { payoutid, user_id, amount, withdraw_id } = payid;

      if (!payoutid) continue;

      const res = await axios.get(
        `${process.env.PAYNOW_API_URL}/v1/payout/${payoutid}`,
        {
          headers: {
            "Authorization": `Bearer ${jwtToken}`,
            "x-api-key": process.env.APIKEY
          }
        }
      );

      const data = res.data.withdrawals?.[0];
      if (!data) continue;
      const status = data.status;

await pool.execute(
  "UPDATE withdraw SET status=? WHERE withdraw_id=? AND status='processing'",
  [status, withdraw_id]
);

      if (status.toLowerCase() === 'rejected' || status.toLowerCase() === 'failed') {
        await pool.query(
          "UPDATE balance SET amount = amount + ? WHERE userid = ?",
          [amount, user_id]
        );
      }
    }
  } catch (err) {
    console.log('Error in withdraw status controller', err.response?.data?.message || err.message);
  }
};




const handleInvestment = async (req, res) => {

  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Permision denied" })
  }
  const { uid } = req.user;

  try {
    const { amount, period, reffercode } = req.body;

    if (!amount || !period) {
      return res.status(400).json({ message: `Field required! ` })
    }

    let duration = 0;
    if (period === '90 days') duration = 90;
    else if (period === '120 days') duration = 120;
    else if (period === '180 days') duration = 180;
    else if (period === '1 years') duration = 365;
    else if (period === '2 years') duration = 365 * 2;
    else if (period === '3 years') duration = 365 * 3;
    else {
      return res.status(400).json({ message: 'Please select duration' })
    }

    const mincapital = 10;
    if (amount < mincapital || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: `manimum capital required ${mincapital} USTD`
      });
    }

    if (amount <= 50 && duration !== 120) {
      return res.status(400).json({
        success: false,
        message: `Fixed duration to ${amount} USDT is 120 days`
      })
    }

    const starteddate = new Date();
    const enddate = new Date(starteddate);
    enddate.setDate(starteddate.getDate() + parseInt(duration));

    const lastCrediteddate = new Date().toISOString().slice(0, 10);
    const dailyearn = (amount * 4) / 100;
    const totalreturn = dailyearn * duration;

    const [ubalance] = await pool.execute(
      'SELECT `amount` FROM `balance` WHERE userid=?',
      [uid]
    );

    if (!ubalance || ubalance.length === 0) {
      return res.status(404).json({ success: false, message: "Insuffient Funds" })
    }

    const ub = ubalance[0].amount;

    if (parseFloat(amount) > parseFloat(ub)) {
      return res.status(404).json({ success: false, message: "Insuffient Funds" })
    }

    const [result] = await pool.query(
      `INSERT INTO currencytrancker
       (userid, capitalinvested, dailyearn, duration, totalreturns, RemainingCapital,
        startperiod, lockedperiod, lastcrediteddate)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        uid,
        amount,
        dailyearn,
        duration,
        totalreturn,
        amount,
        starteddate,
        enddate,
        lastCrediteddate
      ]
    );

    if (result.affectedRows === 1) {

      await pool.execute(
        'UPDATE `balance` SET `amount`=? WHERE userid=?',
        [ub - amount, uid]
      );

      const [investmentcounter] = await pool.execute(
        'SELECT COUNT(*) as total FROM currencytrancker WHERE userid=?',
        [uid]
      );

      const totalinv = investmentcounter[0].total;

      if (totalinv === 1 && reffercode) {
        try {
          const [user] = await pool.execute(
            'SELECT userid FROM users WHERE Refferal_code=?',
            [reffercode]
          );

          if (user.length > 0) {
            const refferid = user[0].userid;
            const commission = Number(amount) * 15 / 100;
            await CreditDBwithnewBalance(commission, refferid);
          }
        } catch (err) {
          console.error("Commission error:", err.message);
        }
      }

      return res.status(201).json({
        success: true,
        message: "Plan creation success",
      });
    }

    return res.status(500).json({
      success: false,
      message: "plan creation fail"
    });

  } catch (error) {
    console.error('Error in handle investment controller', error);
    return res.status(500).json({
      success: false,
      message: "Plan creation fail due to server error"
    });
  }
};




const Dashboard_value = async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Permission denied!" });
  }

  const { uid } = req.user;

  try {
    const [result] = await pool.query(
      `SELECT 
        u.userid,
        COALESCE(b.amount, 0.00) AS amount,
        SUM(COALESCE(ct.capitalinvested, 0.00)) AS capital,
        SUM(COALESCE(ct.remainingCapital, 0.00)) AS remaincp,
        SUM(COALESCE(ct.dailyearn, 0.00)) AS earn,
        SUM(COALESCE(ct.totalearned, 0.00)) AS amountearned,
        SUM(COALESCE(ct.totalreturns, 0.00)) AS totalreturns,
        MAX(ct.duration) AS duration,
        MAX(ct.status) AS status
      FROM users u
      LEFT JOIN balance b ON b.userid = u.userid
      LEFT JOIN currencytrancker ct ON ct.userid = u.userid AND LOWER(ct.status)='active'
      WHERE u.userid = ?
      GROUP BY u.userid, b.amount;`,
      [uid]
    );

    return res.json({ data: result[0] });
  } catch (err) {
    console.error('Error in Dashboard_value Controllers', err.message);
    return res.status(500).json({ message: "Server error" });
  }
}






const GetCurrentUserInfo=async(req,res)=>{

  try{
   if(!req.user|| !req.user.uid) return res.status(401).json({message:"permision denied!"})
    const {uid}=req.user

    const [user]=await pool.execute(`SELECT  username, email FROM users WHERE userid=?`,[uid])
    return res.status(200).json(user)

  }
  catch(err){
    return res.status(500).json({message:"server Error"})
  }

}



const Changeuserrecord = async (req, res) => {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Permission denied!" });
  }

  const { uid } = req.user;
  const { username, email } = req.body;

  if (!username || !email) {
    return res.status(400).json({ message: "Fields are required!" });
  }

  const usernameRegex = /^[a-zA-Z0-9._-]+$/;
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  if (!usernameRegex.test(username.trim())) {
    return res.status(400).json({ message: "Invalid username!" });
  }

  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ message: "special characters not allowed!" });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE users SET username=?, email=? WHERE userid=?`,
      [username.trim(), email.trim(), uid]
    );

    if (result.affectedRows === 1) {
      return res.status(200).json({ message: "New changes saved" });
    }

    return res.status(400).json({ message: "No changes made" });
  } catch (err) {
    console.log("Error in change user record controller", err.message);
    return res.status(500).json({ message: "System crash due to server error" });
  }
};


const TransactonHistory= async(req,res)=>{
  try{
    if(!req.user|| !req.user.uid){
      return res.status(401).json({message:"Permision denied!"})
    }
    const {uid}=req.user
    const [result]=await pool.execute(`SELECT 
transactiondate as date,
COALESCE(paid_amount,0.00) as amount,
status,
trans_type  as type
FROM deposits  WHERE user_id=?
UNION ALL  SELECT with_date as date, 
COALESCE(amount,0.00) as 
 amount,status,withtype as type FROM withdraw WHERE user_id=? ORDER BY date ASC`,[uid,uid])
          
          if(result.length===0){
            return res.status(404).json({message:"No Recent Payouts transaction History"})
          }
          return res.status(200).json(result)
        
        }
    
  catch(err){
    console.log(err)
    console.log('Error in Transaction controllers',err.message)
  }
}



const Capitalstatus= async(req,res)=>{
  try{
    
    if(!req.user ||!req.user.uid){
      return res.status(401).json({message:"Permision denied!"})
    }
    const {uid}=req.user
    
    const [response]=await pool.execute(`
      SELECT id,userid,  lastcrediteddate,
        capitalinvested,dailyearn,
       totalearned, totalreturns
       , startperiod,
        status FROM currencytrancker
         WHERE userid=?`,[uid])

    if(response.length===0){
      return res.status(404).json({message:'There is no current capital please create plan!'})
    }

    return res.status(200).json(response)





  }
  catch(err){
     return res.status(500).json({message:err.message})
  }
}


const Cashout=async (req,res)=>{
  try{
    if(!req.user||!req.user.uid){
      return res.status(401).json({message:"Permision denied!"})

    }

    const {cpid,userid}=req.params
    const {capital,status,totalearn}=req.body;
    if(!cpid || !userid){
     return res.status(401).json({message:"Invalid Cashout"})

    }

    const maxfeespercapital=25;

    const fees=parseFloat(capital)*maxfeespercapital/100
     if(status==='locked'){
      return res.status(403).json({message:"Capital is Locked try again !"})

     }
    if(status==='cashouted'|| status!=='active'){
      return res.status(401).json({message:"cashout can`t be done more than once!"})
    }
    const  totalfees=parseFloat(fees)+parseFloat(totalearn)
    const  expectedcashout=parseFloat(capital)-totalfees
    if(expectedcashout<=0){
      return res.status(403).json({message:"something went wrong!"})
    }

    await CreditDBwithnewBalance(expectedcashout,userid)
    
  const [result]=  await pool.execute(`UPDATE currencytrancker 
SET status='cashouted',
capitalinvested=0,
dailyearn=0,
totalreturns=0,
duration='null',
RemainingCapital=0,
lastcrediteddate=?,
 totalearned='0' WHERE id=? AND userid=?`,[new Date().toISOString().slice(0,10),cpid,userid])
 
if(result.affectedRows===1){
  return res.status(200).json({message:`Cashout successfully of ${expectedcashout} USDT`})
}


     
  }
  catch(err){
    console.log('Error in cashout controller ',err.message)
    return res.status(500).json({message:err.message})
  }
}



const useremailForReceivingResetLink = async (req, res) => {
  try {
    const { email } = req.body;

    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({ message: "Special characters not allowed or invalid email!" });
    }

    const [user] = await pool.execute(
      `SELECT userid FROM users WHERE email=?`,
      [email.trim()]
    );

    if (user.length === 0) {
      return res.status(403).json({ message: "Invalid email!" });
    }

    let owner = user[0];
    const token = crypto.randomBytes(16).toString("hex");
    const expiration = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const [countemailresetperuser] = await pool.execute(
      `SELECT COUNT(*) AS total FROM password_resets WHERE user_id=?`,
      [owner.userid]
    );

    if (countemailresetperuser[0].total >= 5) {
      return res.status(401).json({
        message: "Maximum password reset is 5 times. Email restricted.",
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO password_resets(user_id, email, token, expires_at) VALUES (?,?,?,?)`,
      [owner.userid, email.trim(), token, expiration]
    );

    if (result.affectedRows === 1) {
      const resetlink = `https://xcurrency.vercel.app/reset-password/${token}`;
      
      const emailStatus = await transporter({
        to: email.trim(),
        subject: "XCurrency  Password Reset Link",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd;">
            <h2>Xcurrency Password Reset</h2>
            <p>You requested a password reset. Click the button below to proceed:</p>
            <a href="${resetlink}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
            <p>This link will expire in 15 minutes.</p>
            <p>If you didn't request this, ignore this email.</p>
          </div>
        `,
        text: `Reset your password here: ${resetlink}` 
      });

      if (emailStatus.success) {
        return res.status(200).json({
          message: "Password Reset Link was sent on email",
        });
      } else {
        return res.status(500).json({ message: "Email delivery failed. Try again later." });
      }
    }
  } catch (err) {
    console.error("Error in email reset receiver:", err);
    return res.status(500).json({ message: "Server error!" });
  }
};


const VerifylinkTokenANDResetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token) {
      return res.status(403).json({ message: "Invalid Link" });
    }

    if (!password) {
      return res.status(400).json({ message: "Password is required!" });
    }

    const passwordRegex = /^[a-zA-Z0-9]+$/;

    if (!passwordRegex.test(password)) {
      return res
        .status(400)
        .json({ message: "Special characters not allowed!" });
    }

    const [verifytoken] = await pool.execute(
      `SELECT id, user_id, token FROM password_resets
       WHERE token=?
       AND expires_at > NOW()
       AND used=0`,
      [token]
    );

    if (verifytoken.length === 0) {
      return res.status(400).json({ message: "Link expired, try again!" });
    }

    let userid = verifytoken[0].user_id;
    let rowid = verifytoken[0].id;

    const salt = await bcrypt.genSalt(8);
    const hashedpassword = await bcrypt.hash(password, salt);

    const [response] = await pool.execute(
      `UPDATE users SET password=? WHERE userid=?`,
      [hashedpassword, userid]
    );

    if (response.affectedRows === 1) {
      await pool.execute(
        "UPDATE password_resets SET used=1 WHERE id=? AND user_id=?",
        [rowid, userid]
      );

      return res.status(200).json({ message: "Reset password success" });
    }
  } catch (err) {
    console.log(`Error in VerifyToken and Reset ${err.message}`);
    return res.status(500).json({ message: "Server error!" });
  }
};



const DeleteExpiredToken=async ()=>{
  try{
       const [getexpiredtoken]=await pool.execute(`SELECT  token FROM password_resets WHERE expires_at<NOW()`)
        if(getexpiredtoken.length===0){
          return
        }

       for (let token of getexpiredtoken){

         const exptoken=token.token
          await pool.execute('DELETE FROM `password_resets` WHERE token=?',[exptoken])

       }


  }
  catch(err){
    console.log(`Error in Deleting expired token ${err.message}`)
  }
}



const Refferalstatus= async(req,res)=>{
  try{  
    let totalcapital=0;

    if(!req.user || !req.user.uid){
      return false
    }
    const {uid}=req.user;
    const [reffcode]=await pool.execute('SElECT  Refferal_code FROM users WHERE userid=?',[uid])
    const [reffereduserid]=await pool.execute('SElECT  userid FROM users WHERE invitorcode=?',[reffcode[0].Refferal_code])
     if(reffereduserid.length===0){
      return res.status(404).json({message:"NO current Refferals!"})
     }

   
     for (let user  of reffereduserid){
      const id=user.userid
      
      const [capital]= await pool.execute('SELECT capitalinvested FROM currencytrancker WHERE userid=?',[id])
        if(capital.length===0)continue
        let ucapital=capital[0].capitalinvested
        totalcapital+=Number(ucapital)
     }

     const [totalrefferal]=await pool.execute("SELECT COUNT(*) AS total FROM users WHERE invitorcode=?",[reffcode[0].Refferal_code])
      let totaluser=totalrefferal[0].total
      return res.status(200).json({totalcapital,totaluser})
    

  }
  catch(err){
    console.log('Error in Refferal status controllers',err.message)
  }
}


const HandleCurrencyEarnTracker = async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todayTime = new Date(today).getTime();

    const [users] = await pool.query(
      'SELECT userid FROM balance'
    );

    for (const user of users) {
      const { userid } = user;

      const [trackers] = await pool.query(
        `SELECT id, capitalinvested, dailyearn, totalearned, totalreturns,
                startperiod, lockedperiod, lastcrediteddate, RemainingCapital
         FROM currencytrancker
         WHERE userid=? AND status='active'`,
        [userid]
      );

      if (!trackers.length) continue;

      const [balanceRow] = await pool.query(
        'SELECT amount FROM balance WHERE userid=?',
        [userid]
      );
      if (!balanceRow.length) continue;

      for (const row of trackers) {
        const {
          id,
          capitalinvested,
          dailyearn,
          totalearned,
          lockedperiod,
          lastcrediteddate,
          RemainingCapital,
          totalreturns,
          startperiod
        } = row;

        const lockDate = new Date(lockedperiod).toISOString().slice(0, 10);

        if (today >= lockDate) {
          await pool.query(
            'UPDATE currencytrancker SET status="locked" WHERE id=?',
            [id]
          );
          continue;
        }

        const lastDate = lastcrediteddate
          ? new Date(lastcrediteddate).toISOString().slice(0, 10)
          : new Date(startperiod).toISOString().slice(0, 10);


        const lastDateTime = new Date(lastDate).getTime();
        const diffInMs = todayTime - lastDateTime;
        const missedDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
        if (missedDays <= 0) continue;
        if (lastDate === today) continue;


        
        const earned = parseFloat(dailyearn) * missedDays;

        const newTotalEarned = parseFloat(totalearned) + earned;
        const remainingCapital = capitalinvested - newTotalEarned;

        if (newTotalEarned >= parseFloat(totalreturns)) {
          await pool.query(
            'UPDATE currencytrancker SET status="locked" WHERE id=?',
            [id]
          );
        }

        await CreditDBwithnewBalance(earned, userid);

        if (remainingCapital <= 0) {
          await pool.query(
            `UPDATE currencytrancker
             SET totalearned=?,
                 RemainingCapital=0,
                 lastcrediteddate=?
             WHERE id=?`,
            [newTotalEarned, today, id]
          );
        } else {
          await pool.query(
            `UPDATE currencytrancker
             SET totalearned=?,
                 RemainingCapital=?,
                 lastcrediteddate=?
             WHERE id=?`,
            [newTotalEarned, remainingCapital, today, id]
          );
        }
      }
    }
  } catch (error) {
    console.log('tracker daily Earning Error', error);
  }
};




nodecron.schedule("*/30 * * * * *", async () => {
  await processWithdrawals();
  await PoolDeposit()
   await trackeWithdrawstatus()
},{
  timezone:"africa/kigali"
});
nodecron.schedule('*/1 * * * *', async () => {
  await HandleCurrencyEarnTracker()
   await DeleteExpiredToken()

},{
  timezone:'africa/kigali'
});




module.exports = {
   DepositAddress,
   GetCurrentUserInfo
  ,handleInvestment,
  Dashboard_value ,
  Withdraw,
  Changeuserrecord,
  TransactonHistory,
  Capitalstatus,
  Cashout,
  useremailForReceivingResetLink,
  VerifylinkTokenANDResetPassword,
  Refferalstatus,
  };

