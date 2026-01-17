

const jwt= require('jsonwebtoken')


require('dotenv').config()

const CheckToken=(req,res,next)=>{
       try{
const Utoken=req.headers.authorization?.split(" ")[1]
    if(!Utoken){
        return res.status(401).json({message:"Permission denied!"})
    }

  const user=jwt.verify(Utoken,process.env.JWTSECRETKEY)
  req.user=user
  
  next()
       }
     catch(error){
        return res.status(403).json({message:"Token Extracting Error!",error})
     }
}


module.exports={
    CheckToken

}
