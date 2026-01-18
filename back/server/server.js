const express=require('express')
const cors=require('cors')
const dot_env=require('dotenv')
const app=express()
const morgan=require('morgan')


dot_env.config()





app.use(morgan(process.env.ISINPRODUCTION==='production' ? 'dev':'combined'))


const pool=require('./connection/conn')
app.use((req, res, next) => {
  if (req.headers['content-type'] === 'application/json') {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      req.rawBody = data;
      next();
    });
  } else {
    next();
  }
});

app.use(express.json())
app.use(express.urlencoded({ extended: true }));

const routes=require('./routes/routes')

app.use(cors({
    origin:'https://xcurrency.vercel.app',
    method:['POST','GET','DELETE','PUT'],
    credentials:true
}))
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

module.export=app;