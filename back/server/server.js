const express=require('express')
const cors=require('cors')
const dot_env=require('dotenv')
const app=express()
const morgan=require('morgan')


dot_env.config()





app.use(morgan(process.env.ISINPRODUCTION==='production' ? 'dev':'combined'))


const pool=require('./connection/conn')
const routes=require('./routes/routes')


app.use(express.json())
app.use(express.urlencoded({ extended: true }));


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