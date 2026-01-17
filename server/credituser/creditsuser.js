
const pool=require('../connection/conn')



const CreditDBwithnewBalance = async (amount, userid) => {

  try {
    const [currrentrecord]=await pool.execute(`SELECT  
      userid,COALESCE(amount) as amount FROM balance WHERE userid=?`,[userid])
    if(currrentrecord.length===0){
     await pool.execute(`INSERT INTO balance(userid, amount) VALUES(?,?)`,[userid,amount])
    
    } 
   if(currrentrecord.length===1){
     const [result] = await pool.query(
      'UPDATE balance SET amount = amount + ? WHERE userid = ?',
      [amount, userid]

    )

    if (result.affectedRows === 1) {
      console.log('Balance credited:', amount)
      return true
    }
    return false
   }

    
  } catch (err) {
    console.error('Error crediting balance', err)
  }
}



module.exports={CreditDBwithnewBalance}