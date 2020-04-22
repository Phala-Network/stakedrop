const mysql = require('sync-mysql');
const connection = new mysql({
  host: 'localhost',
  user: 'root',
  password: '12345678'
});


function query(sql) {
  console.log(sql);

  try {
    let result = connection.query(sql);
    //console.log(JSON.stringify(result));
    return result;
  } catch (err) {
    console.log(err);
    return null;
  }
}

module.exports = { query }