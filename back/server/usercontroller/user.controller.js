const pool = require('../connection/conn');
const bcrypt = require('bcrypt');
const crypto=require('crypto')
const jwt=require('jsonwebtoken')


let regex = /^[A-Za-z0-9\s@]*$/;


const generateUniqueRefCode = async () => {
  let isUnique = false;
  let code;

  while (!isUnique) {
    code = crypto.randomBytes(4).toString('hex');

    const [rows] = await pool.query(
      'SELECT COUNT(*) AS count FROM users WHERE Refferal_code = ?',
      [code]
    );

    if (rows[0].count === 0) {
      isUnique = true;
    }
  }

  return code;
};



const Register = async (req, res) => {
  try {
    const { username, email, password, invcode} = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({
        message: "All fields are required",
        success: false
      });
    }

    if(!regex.test(username,email,password)){
      return res.status(400).json({message:"special characters not allowed!"})
    }

    if(!email.includes('@')){
      return res.status(400).json({message:"Invalid email formart!"})
    }

    const [userExists] = await pool.query(
      'SELECT userid FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (userExists.length > 0) {
      return res.status(409).json({
        message: "Username or email already exists",
        success: false
      });
    }

    const salt = await bcrypt.genSalt(8);
    const hashedPassword = await bcrypt.hash(password, salt);

    const referralCode = await generateUniqueRefCode();

      const [result]=await pool.execute(`INSERT INTO users(username, email, password,
         Refferal_code, invitorcode) VALUES (?,?,?,?,?)`,
        [username,email,hashedPassword,referralCode,invcode])

    const newuserid=result.insertId

    if (newuserid) {
          
        const MAX_LEVEL = 7;
        let requiredusers;
        let reward;
        let title;

        for (let level = 1; level <= MAX_LEVEL; level++) {
          if(level==1){
             requiredusers=8;
             reward=12
             title='Level 1'
          }
          if(level==2){
            requiredusers=20;
            reward=18
             title='Level 2'

          }
          if(level==3){
            requiredusers=32
            reward=28
             title='Level 3'
          }
           if(level==4){
            requiredusers=50
            reward=35
             title='Level 4'

          }
           if(level==5){
            requiredusers=70
            reward=50
             title='Level 5'


          }
           if(level==6){
            requiredusers=100
            reward=70
             title='Level 6'

          }

          if(level==7){
            requiredusers=160
            reward=100
             title='Level 7'

          }
          

          let status = 'locked';
        
          await pool.query(
            `INSERT INTO user_levels (user_id, level, status,requiredUsers,reward,title)
             VALUES (?, ?, ?,?,?,?)`,
            [newuserid, level, status,requiredusers,reward,title]
          );
        }
      
    }

    return res.status(201).json({
      message: "Registration successful. Please login.",
      success: true
    });

  } catch (err) {

    console.error('Register Error:', err.message);
    return res.status(500).json({
      message: "Registration failed. Please try again later.",
      success: false
    });
  }
};


const Login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return  false
    }
    
    if(!regex.test(username,password)){
       return res.status(400).json({message:"Special characters not allowed!"})
    }

    
    const [rows] = await pool.query('SELECT * FROM `users` WHERE `username` = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ message: "Login Permission denied!", success:false });
    }

    const user = rows[0];

   
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Login Permission denied!" ,success:false});
    }

    if(match){
        const token=jwt.sign({uid:user.userid,username:user.username,code:user.Refferal_code},process.env.JWTSECRETKEY,{expiresIn:'24h'})
        if(token){
            return res.status(201).json({uToken:token,success:true})
        }
    }
  } catch (err) {
    console.log(err)
    console.error("Error in Login Controller:", err.message);
    return res.status(500).json({ message: "Login failed Try again!" });
  }
};

module.exports = { Register, Login };
