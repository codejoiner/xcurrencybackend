const express=require('express')
const cors=require('cors')
const dot_env=require('dotenv')
const app=express()
const morgan=require('morgan')

const routes=require('./routes/routes')

dot_env.config()





app.use(morgan(process.env.ISINPRODUCTION==='production' ? 'combined':'dev'))


const pool=require('./connection/conn')


app.use(express.json())
app.use(express.urlencoded({ extended: true }));
  
app.use(cors({
    origin:"https://xcurrency.vercel.app",
    method:['POST','GET','DELETE','PUT'],
    credentials:true
}))

const rateLimitMap = new Map();
const blockedIPs = new Set();

const rateLimit = (req, res, next) => {
  const ip = req.ip;
  console.log(ip)

  
  if (blockedIPs.has(ip)) {
    return res.status(429).json({ message: "Blocked due to repeated violations." });
  }

  const now = Date.now();
  const windowTime = 60 * 1000;
  const maxRequests = 50; 

  const record = rateLimitMap.get(ip) || { count: 0, startTime: now };

  
  if (now - record.startTime > windowTime) {
    record.count = 1;
    record.startTime = now;
  } else {
    record.count += 1;
  }

  rateLimitMap.set(ip, record);

  
  if (record.count > maxRequests) {
    blockedIPs.add(ip);

  
    setTimeout(() => blockedIPs.delete(ip), 10 * 60 * 1000);

    return res.status(429).json({
      message: "Too many requests. Blocked for 10 minutes."
    });
  }

  next();
};

 app.use(rateLimit)

app.use('/',routes)




const Server=app.listen(process.env.PORT,(error)=>{
    if(!error){
        console.log(`server running on ${process.env.PORT}`)
    }
})


const shutdowngracefull= async(error)=>{
   console.log('server shutdown due to error ',error)
   Server.close(()=>{
    pool.end()
   })

   process.exit(0)
}

process.on('uncaughtException',shutdowngracefull);
process.on('unhandledRejection', shutdowngracefull);

module.exports=app;