const { compare } = require("bcrypt")
const pool = require("../../connection/conn")
const  {CreditDBwithnewBalance}=require('../../credituser/creditsuser')




const getlevelvalues = async (req, res) => {
    if (!req.user || !req.user.uid) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    const { uid } = req.user

    try {
        const [response] = await pool.execute(
            `SELECT level, status, reward, requiredUsers, statusText, CurrentUsers, title
             FROM user_levels WHERE user_id=?`,
            [uid]
        )
        return res.status(200).json(response)
    } catch (err) {
        console.error(err.message)
        return res.status(500).json({ message: "System error" })
    }
}


const recordunlockedLevel=async(userid,reward,level)=>{
      try{
         await pool.execute(`INSERT INTO unlockedreward(userid, reward, unlockedlevel) 
            VALUES (?,?,?)`,[userid,reward,level])
       }  
      catch(err){
        console.log('Error in record level ',err.message)
      }
}



const Teamchecking = async (userid, level, reward,users) => {
   const today=new Date().toISOString().slice(0,10)
    const levelCapital = {
        1: 900,
        2: 1200,
        3: 1500,
        4: 2000,
        5: 3000   }

    try {
        let totalcapital = 0  

        const [reffcode] = await pool.execute(
            "SELECT Refferal_code FROM users WHERE userid=?",
            [userid]
        )

        if (reffcode.length === 0) return { qualified: false }

        const code = reffcode[0].Refferal_code

        const [allinviteduserid] = await pool.execute(
            "SELECT userid FROM users WHERE invitorcode=?",
            [code]
        )

        for (const user of allinviteduserid) {
            const [capitalrow] = await pool.execute(
                "SELECT SUM(capitalinvested) AS capital FROM currencytrancker WHERE userid=?",
                [user.userid]
            )

            const capital = capitalrow[0].capital
            if (capital) totalcapital += Number(capital)
        }


        const requiredCapital = levelCapital[level]
        if (!requiredCapital)  {
          return {qualified:false}
         }

        if (totalcapital >= requiredCapital) {
          await CreditDBwithnewBalance(reward, userid)
          await recordunlockedLevel(userid,reward,level)
          console.log('quarified')
          await pool.execute('UPDATE `unlockedreward` SET `lastcrediteddate`=?  WHERE userid=?',[today,userid])
        }
        else{
           await pool.execute(`UPDATE user_levels SET status='locked' ,statusText='locked'
                WHERE user_id=? AND level=?`,[userid,level])
          await recordunlockedLevel(userid,reward,level)

        }

       

    } catch (err) {
        console.error(err.message)
        return { qualified: false }
    }
}

const handlreffallogic = async () => {
    try {
        const [users] = await pool.execute("SELECT userid FROM users")

        for (const user of users) {
            const uid = user.userid

            const [ref] = await pool.execute(
                "SELECT Refferal_code FROM users WHERE userid=?",
                [uid]
            )

            if (!ref.length) continue

            const code = ref[0].Refferal_code

            const [countrow] = await pool.execute(
                "SELECT COUNT(*) AS total FROM users WHERE invitorcode=?",
                [code]
            )

            const totalusers = countrow[0].total
            if (totalusers < 1) continue
            if(totalusers===1){
                  await pool.execute(
                `UPDATE user_levels
                 SET status='active',statusText='inprogress', CurrentUsers=?
                 WHERE user_id=? AND level=1`,
                [totalusers, uid]
            )
            }

            const [activeLevel] = await pool.execute(
                `SELECT level, reward, requiredUsers, user_id
                 FROM user_levels
                 WHERE user_id=? AND status='active'`,
                [uid]
            )

            if (!activeLevel.length) continue
          
             await pool.execute(
                `UPDATE user_levels
                 SET CurrentUsers=?
                 WHERE user_id=? AND level=?`,
                [totalusers, uid, activeLevel[0].level]
            )
          
           

              

             if (totalusers == activeLevel[0].requiredUsers) {
                const lvl = activeLevel[0].level
                const reward = activeLevel[0].reward

            

                const [row] = await pool.execute(
                    `UPDATE user_levels
                     SET status='completed', statusText='completed'
                     WHERE user_id=? AND level=?`,
                    [uid, lvl]
                )


                if (row.affectedRows === 1) {
                    await Teamchecking(uid, lvl, reward)
                    
                    await pool.execute(
                        `UPDATE user_levels
                         SET status='active', statusText='inprogress', CurrentUsers=?
                         WHERE user_id=? AND level=?`,
                        [totalusers, uid, lvl + 1]
                    )
                }

                

            
                
            }


           
        }
    } catch (err) {
        console.error(err.message)
    }
}



const TrackerLevelUnlockedHistory=async ()=>{
    
    let totalinvusercapital=0;
    let today=new Date().toISOString().slice(0,10);
     const levelCapital = {
        1: 900,
        2: 1200,
        3: 1500,
        4: 2000,
        5: 3000,
        6:5000 ,
        7:7000  
    }

    try{
        const [users]=await pool.execute('SELECT id,userid,unlockedlevel,reward,lastcrediteddate FROM unlockedreward')
        for(let  user of users){
         const userid=user.userid
         const unlockedlevel=user.unlockedlevel
         const reward=user.reward

        let [levelstatus]=await pool.execute(`SELECT status FROM
             user_levels WHERE level= ? AND  user_id=?`,[unlockedlevel,userid])
         const status=levelstatus[0].status
         if(status==='locked'){
             const [reffcode] = await pool.execute(
            "SELECT Refferal_code FROM users WHERE userid=?",
            [userid]
        )

        if (reffcode.length === 0) continue

        const code = reffcode[0].Refferal_code

        const [allinvusers] = await pool.execute(
            "SELECT userid FROM users WHERE invitorcode=?",
            [code]
        )
         
        for (let invitedid of allinvusers){
            const inviteduid=invitedid.userid
             const [capitalrow] = await pool.execute(
                "SELECT SUM(capitalinvested) AS capital FROM currencytrancker WHERE userid=?",
                [inviteduid]

            )
            if(capitalrow.length===0) continue
             const capital=capitalrow[0].capital
              if(capital) totalinvusercapital+=Number(capital)


        }
        console.log(totalinvusercapital)

        const requiredcapital=levelCapital[unlockedlevel]
         
        if(!requiredcapital) return false
        
        if(totalinvusercapital>=requiredcapital){
            await pool.execute(`UPDATE user_levels SET status='completed'
                ,statusText='completed' WHERE user_id= ? AND level=?`,[userid,unlockedlevel])
       
        }
 
         }
         else{
            if(status==='completed'){
                const lastCrediteddate=new Date(user.lastcrediteddate).toISOString().slice(0,10)
                if(lastCrediteddate===today||lastCrediteddate===null){
                    continue
                }
                  
                 await CreditDBwithnewBalance(reward,userid)
                 await pool.execute('UPDATE `unlockedreward` SET `lastcrediteddate`=? WHERE  id=? AND userid=?',[today,user.id,userid])

               
            }
           
         }


        }

    }
    catch(err){
        console.log('Error in tracker unlocked level history',err.message)
    }

}


module.exports = {
    handlreffallogic,
    getlevelvalues,
    TrackerLevelUnlockedHistory
}
