const axios = require("axios");
const crypto = require("crypto");
const bcrypt=require('bcrypt')
require("dotenv").config();

const pool = require("../connection/conn");
const nodecron=require('node-cron');
const {CreditDBwithnewBalance}=require('../credituser/creditsuser')

const { handlreffallogic,TrackerLevelUnlockedHistory } = require("./refferal/reffal");



const getminiamount=async()=>{
  const response=await axios.get(`${process.env.PAYNOW_API_URL}/v1/min-amount`,{params:{
    currency_from:'usdtbsc',
    currency_to:"usd"
  },headers:{"x-api-key":process.env.APIKEY}})
  return response.data.min_amount
}


async function DepositAddress(req, res) {

  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Permission denied!" });
  }
  
  const uid = req.user.uid;
  const MIN_USDT_BSC_USD = 10;
  const minamount=await getminiamount()
  const safeAmount = Math.max((minamount,MIN_USDT_BSC_USD)) ;

  try {
    const response = await axios.post(
      `${process.env.PAYNOW_API_URL}/v1/payment`,
      {
        price_amount: safeAmount, 
        price_currency: 'usd',
        pay_currency: "usdtbsc",
        order_id: uid.toString(),
          ipn_callback_url: "https://xcurrencybackend-5.onrender.com/api/Nowpayments/webhook"
      },
      {
        headers: { 
          "x-api-key": process.env.APIKEY, 
          "Content-Type": "application/json"
        }
      }
    );

    const { pay_address} = response.data;

    

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



const Withdraw = async (req, res) => {
  const minamount = 5;

  if (!req.user || !req.user.uid) {
    return res.status(401).json({ message: "Permission denied" });
  }

  const { uid } = req.user;
  const { amount, walletAddress, network } = req.body;
  const amountNumber = Number(amount);

  if (!amount || !walletAddress || !network) {
    return res.status(400).json({ message: "amount, walletAddress and network are required!" });
  }

  if (amountNumber < minamount) {
    return res.status(400).json({ message: `MINIMUM WITHDRAW ${minamount} USDT` });
  }

  if (isNaN(amountNumber) || amountNumber <= 0) {
    return res.status(400).json({ message: "Invalid withdraw amount" });
  }

  const regex = /^[a-zA-Z0-9]+$/;
  if (!regex.test(walletAddress) || walletAddress.trim().length < 10) {
    return res.status(400).json({ message: "Invalid wallet address format!" });
  }

  try {
    const [ubalance] = await pool.query(
      "SELECT amount FROM balance WHERE userid = ?",
      [uid]
    );

    if (!ubalance || ubalance.length === 0) {
      return res.status(404).json({ message: "User balance not found" });
    }

    const userbalance = parseFloat(ubalance[0].amount);

    if (amountNumber > userbalance) {
      return res.status(400).json({ message: "Insufficient Funds" });
    }

   
    const authResponse = await axios.post(`${process.env.PAYNOW_API_URL}/v1/auth`, {
      email: process.env.NOWPAYMENTSEMAIL,
      password: process.env.NOWPAYMENTSPASSWORD
    });

    const jwtToken = authResponse.data.token;

 console.log(jwtToken,process.env.NOWPAYMENTSPASSWORD,process.env.NOWPAYMENTSEMAIL)
  
    const payoutResponse = await axios.post(
      `${process.env.PAYNOW_API_URL}/v1/payout`,
      {
        withdrawals: [
          {
            address: walletAddress,
            currency: "usdt",
            amount: amountNumber,
            network: network         }
        ],
        ipn_callback_url: "https://xcurrencybackend-5.onrender.com/api/Nowpayments/webhook"
      },
      {
        headers: {
          "x-api-key": process.env.APIKEY,
          "Authorization": `Bearer ${jwtToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    await pool.query(
        "UPDATE balance SET amount = amount - ? WHERE userid = ?",
        [amountNumber, uid]
    );

    return res.status(200).json({
      message: "Withdrawal initiated successfully!",
    });

  } catch (error) {
    console.error("Error details:", error.response?.data || error.message);
    
    const errorMessage = error.response?.data?.message || "Internal Server Error";
    return res.status(error.response?.status || 500).json({
      message: "Withdrawal failed",
      details: errorMessage
    });
  }
};


const handleInvestment = async (req, res) => {

  if(!req.user||!req.user.uid){
    return res.status(401).json({message:"Permision denied"})
  }
  const { uid } = req.user;

  try {
    const { amount, period } = req.body;
    
    if(!amount|| ! period){
      return res.status(400).json ({message:`Field required! `})
    }
    if(amount<=0){
         return res.status(400).json ({message:`Invalid amount `})
    }
    
   

   
    
    let duration=0;
    if(period==='90 days'){
    duration+=90;
  
    }
    else if(period==='120 days'){
    duration+=120;
    }
   
    else if(period==='180 days'){
      duration+=180
    }
    else if(period==='1 years'){
      duration+=365

    }
    else if(period==='2 years'){
      duration+=365*2

    }
     else if(period==='3 years'){
      duration+=365*3
    }
    else{
      return res.status(400).json({message:'Please select duration'})
    }
    const mincapital = 10;

 if(amount ==10 && duration !==120){
    return res.status(400).json({message:`Fixed duration to ${mincapital}USDT is 120 days`})
    }
   

    if (amount < mincapital) {
      return res.status(400).json({
        success: false,
        message: `manimum capital  required ${mincapital} USTD`
      });
    }

    const starteddate = new Date();
    const enddate = new Date(starteddate);
    enddate.setDate(starteddate.getDate() + parseInt(duration));

    const lastCrediteddate = new Date().toISOString().slice(0, 10);
    const dailyearn = (amount * 5) / 100;
    const totalreturn=dailyearn*duration


    const [ubalance]= await pool.execute('SELECT  `amount` FROM `balance` WHERE userid=?',[uid])
    
    if(!ubalance||ubalance.length===0){
      return res.status(404).json({message:"Insuffient Funds"})
    }

    const ub=ubalance[0].amount
    
if(parseFloat(amount)>parseFloat(ub)){
   return res.status(404).json({message:"Insuffient Funds"})
}

    const [result] = await pool.query(
      `INSERT INTO currencytrancker
       (userid, capitalinvested, dailyearn,duration,totalreturns,RemainingCapital,
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

    if(result.affectedRows===1){
     await pool.execute('UPDATE `balance` SET`amount`=? WHERE userid=?',[ub-amount,uid])
    }

    if (result.affectedRows === 1) {
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
      message: "Plan creation fail  due to server error"
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
      return res.status(404).json({message:'There is No current capital Please create Plan'})
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
      return res.status(400).json({ message: "special characters not allowed!" });
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
    const expiration = new Date(Date.now() + 15 * 60 * 1000);

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

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
      const resetlink = `${process.env.FRONTEND_URL}/reset-password/${token}`;
      console.log(resetlink);
      return res.status(200).json({
        message: "Password Reset Link was sent on email",
      });
    }
  } catch (err) {
    console.log("Error in email reset receiver", err.message);
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









nodecron.schedule('*/1 * * * *', async () => {
  await HandleCurrencyEarnTracker()
  await handlreffallogic()
   await DeleteExpiredToken()
   TrackerLevelUnlockedHistory()
},{
  timezone:'africa/kigali'
});
const NowpaymentsWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-nowpayments-sig'];

    if (!signature || !req.rawBody) {
      console.log('empty signature or rawBody');
      return res.status(400).json({ message: 'Bad Request' });
    }

    const expected = crypto
      .createHmac('sha512', process.env.IPNKEY)
      .update(req.rawBody)
      .digest('hex');

    if (expected !== signature) {
      console.log('Invalid signature');
      return res.status(401).json({ message: 'Invalid Signature' });
    }

    // === IMPORTANT: parse rawBody to JSON ===
    const body = JSON.parse(req.rawBody);

    console.log(body);

    // -----------------------------
    // Deposit logic
    // -----------------------------
    if (body.payment_id && body.order_id) {
      const {
        payment_id,
        payment_status,
        pay_amount,
        pay_currency,
        order_id,
      } = body;

      const [rows] = await pool.query(
        'SELECT * FROM deposits WHERE paymentid = ?',
        [payment_id]
      );

      let deposit = rows[0];

      if (!deposit) {
        await pool.query(
          `INSERT INTO deposits (user_id, paymentid, coin, paid_amount, status, credited)
           VALUES (?,?,?,?,?,0)`,
          [order_id, payment_id, pay_currency, pay_amount, payment_status]
        );

        deposit = { user_id: order_id, paid_amount: pay_amount, credited: 0 };
      } else {
        await pool.query(
          'UPDATE deposits SET status=? WHERE paymentid=?',
          [payment_status, payment_id]
        );
      }

      if (payment_status === 'finished' && deposit.credited === 0) {
        const credited = await CreditDBwithnewBalance(
          deposit.paid_amount,
          deposit.user_id
        );

        if (credited) {
          await pool.query(
            'UPDATE deposits SET credited=1 WHERE paymentid=?',
            [payment_id]
          );
        }
      }

      console.log('deposit ok');
    }

    // -----------------------------
    // Withdraw logic (INSERT + UPDATE)
    // -----------------------------
    if (body.payout_id) {
      const { payout_id, status, amount, currency, user_id } = body;

      const [rows] = await pool.query(
        'SELECT * FROM withdraw WHERE payoutid = ?',
        [payout_id]
      );

      let withdraw = rows[0];

      if (!withdraw) {
        // === INSERT new withdraw record ===
        await pool.query(
          `INSERT INTO withdraw (user_id, payoutid, amount, currency, status)
           VALUES (?, ?, ?, ?, ?)`,
          [user_id, payout_id, amount, currency, status]
        );

        withdraw = { user_id, amount, status };
      } else {
        // === UPDATE status if already exists ===
        await pool.execute(
          "UPDATE withdraw SET status=? WHERE payoutid=?",
          [status, payout_id]
        );
      }

      if (status === "failed") {
        await pool.execute(
          "UPDATE balance SET amount = amount + ? WHERE userid = ?",
          [withdraw.amount, withdraw.user_id]
        );
      }

      console.log('withdraw ok');
      return res.status(200).json({ message: 'Withdraw OK' });
    }

    return res.status(400).json({ message: "Unknown webhook type" });

  } catch (err) {
    console.error('NOWPayments webhook error', err);
    return res.status(500).json({ message: err.message });
  }
};































const HandleCurrencyEarnTracker = async () => {
  try {
    const today = new Date().toISOString().slice(0,10)
    

    const [users] = await pool.query(
      'SELECT userid FROM balance'
    )

    for (const user of users) {
      const { userid } = user

      const [trackers] = await pool.query(
        `SELECT id, capitalinvested, dailyearn, totalearned,totalreturns,
              startperiod, lockedperiod, lastcrediteddate,RemainingCapital
         FROM currencytrancker
         WHERE userid=? AND status='active'`,
        [userid]
      )

      if(!trackers.length){
        continue
      }

      const [balanceRow] = await pool.query(
        'SELECT amount FROM balance WHERE userid=?',
        [userid]
      ) 
      if (!balanceRow.length) continue

      let currentBalance = parseFloat(balanceRow[0].amount)

      for (const row of trackers) {
        const {
          id,
          capitalinvested,
          dailyearn,
          totalearned,
          lockedperiod,
          lastcrediteddate,
          RemainingCapital,
          totalreturns
        } = row

        const lockDate = new Date(lockedperiod).toISOString().slice(0,10)

        if (today >= lockDate) {
          await pool.query(
            'UPDATE currencytrancker SET status="locked" WHERE id=?',
            [id]
          )
          continue
        }

        const lastDate = lastcrediteddate
          ? new Date(lastcrediteddate).toISOString().slice(0,10)
          : new Date(row.startperiod).toISOString().slice(0,10)
          if(lastDate===today){
            continue
          }
        
        const earned= parseFloat(dailyearn)
        const newTotalEarned = parseFloat(totalearned) + earned
        const remainingCapital = capitalinvested - newTotalEarned
        if(parseFloat(totalearned)>=parseFloat(totalreturns)){
         await pool.query(
            'UPDATE currencytrancker SET status="locked" WHERE id=?',
            [id]
          )
        }
        await CreditDBwithnewBalance(earned, userid)
        if(parseInt(RemainingCapital)<=0){
           await pool.query(
          `UPDATE currencytrancker
           SET totalearned=?,
               RemainingCapital=0,
               lastcrediteddate=?
           WHERE id=?`,
          [newTotalEarned,today, id]
        )
        }
        else{
            await pool.query(
          `UPDATE currencytrancker
           SET totalearned=?,
               RemainingCapital=?,
               lastcrediteddate=?
           WHERE id=?`,
          [newTotalEarned, remainingCapital, today, id]
        )
        }
      
      }
    }
  } catch (error) {
    console.log('tracker daily Earning Error', error)
  }
}







module.exports = {
   DepositAddress,
   GetCurrentUserInfo
  ,handleInvestment,
  Dashboard_value ,
  Withdraw,
  NowpaymentsWebhook,
  Changeuserrecord,
  TransactonHistory,
  Capitalstatus,
  Cashout,
  useremailForReceivingResetLink,
  VerifylinkTokenANDResetPassword,
  Refferalstatus,
  };
