
const {DepositAddress,handleInvestment,  Dashboard_value, Withdraw, GetCurrentUserInfo, Changeuserrecord,
     TransactonHistory, Capitalstatus, Cashout, useremailForReceivingResetLink, VerifylinkTokenANDResetPassword, Refferalstatus,
    
      NowpaymentsWebhook} =require('../controller/controller')

const {Register,Login}=require('../usercontroller/user.controller')
const express=require('express')

const {CheckToken}=require('../controller/middleware')
const { getlevelvalues } = require('../controller/refferal/reffal')

const router=express.Router()



router.get('/deposit-address',CheckToken,DepositAddress)
router.post('/Register',Register)
router.post('/x-currency-Login',Login)
router.post('/x-currency-investment',CheckToken,handleInvestment)
router.post('/api/Nowpayments/webhook',express.raw({type:'application/json'}),NowpaymentsWebhook)
router.get('/dash-value',CheckToken,Dashboard_value)
router.post('/Xcurrency-Withdraw',CheckToken,Withdraw)
router.get('/x-currency-level',CheckToken,getlevelvalues)
router.get('/x-currency-user-record',CheckToken,GetCurrentUserInfo)
router.put('/user-update-profile',CheckToken,Changeuserrecord)
router.get('/x-currency-history',CheckToken,TransactonHistory)
router.get('/x-currency-capital-status',CheckToken,Capitalstatus)
router.post('/x-currency-user-cashout/:cpid/userid/:userid',CheckToken,Cashout)
router.post('/x-currency-email-check',useremailForReceivingResetLink)
router.post('/x-currency-reset-password/:token',VerifylinkTokenANDResetPassword)
router.get('/refferal-data',CheckToken,Refferalstatus)









module.exports=router