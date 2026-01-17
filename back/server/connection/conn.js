const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.HOST,
  user: process.env.DBUSER,
  password: process.env.DBPWD,
  database: process.env.DBNAME,
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 15000,
  queueLimit: 0,
    typeCast:function(field,next){
        if(field.type==='DATE'){
            return field.string()
        }
        return next()
    }
});

module.exports = pool;
