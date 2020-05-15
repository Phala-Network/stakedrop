const http = require('http');
const https = require('https');
const express = require("express");  
const app = express();  
const url = require('url')

const start_time = 1589536800000; //2020-5-15 18:00:00 GMT +800, 2020-5-15 10:00:00 GMT
const end_time = start_time + 90 * 24 * 60 * 60 * 1000; //1597312800000, 2020-8-13 18::00::00 GMT +800, 2020-8-13 10:00:00 GMT
const total_stakedrop_pha = 27000000;

const mysql = require('mysql');
const param = {
        host     : '',
        user     : '',
        password : '',
        port     : 3306
}
 
let httpServer = http.createServer(app);
httpServer.listen(8080)

// wihtelist
// wihtelist?stash=
app.get("/whitelist", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let stash = q.query.stash;

        let sql = "select * from stakedrop.whitelist";
        if (stash == undefined)
                sql += " where stash not like '5%' order by validator"
        else if (!validate_accountid(stash)) {
                o = {'status':'bad account'};
                res.send(JSON.stringify(o));

                return;
        } else 
                sql += " where stash = '" + stash + "'";
        query(res, sql);
});

// whitelist_stake_sum?stash=&era=
app.get("/whitelist_stake_sum", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let stash = q.query.stash;
        let era = q.query.era;

        if (!validate_era(era) || !validate_accountid(stash)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select count(*) as count, sum(amount) as amount from stakedrop.staker where nominee='" + stash + "' and era=" + era;
        query(res, sql);
});

// whitelist_stake_info?stash=&era=
app.get("/whitelist_stake_info", async function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let stash = q.query.stash;
        let era = await query_max_era(q.query.era);

        if (!validate_era(era) || !validate_accountid(stash)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select nominator, amount from stakedrop.staker where nominee='" + stash + "' and era=" + era;
        query(res, sql);
});

// nominators?era=
app.get("/nominators", async function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let era = await query_max_era(q.query.era);
        
        if (!validate_era(era)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select nominator from stakedrop.nominate where start_era=" + era;
        query(res, sql);
});

// total_staking?era=
app.get("/total_staking", async function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let era = await query_max_era(q.query.era);

        if (!validate_era(era)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select sum(amount) as total_amount from stakedrop.nominate where start_era=" + era;
        query(res, sql);
});

// staking_info?nominator=&era=
app.get("/staking_info", async function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let nominator = q.query.nominator;
        let era = await query_max_era(q.query.era);

        if (!validate_era(era)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql;
        if (!validate_accountid(nominator))
                sql = "select nominator, nominee, amount from stakedrop.nominate where start_era=" + era;
        else
                sql = "select nominator, nominee, amount from stakedrop.nominate where start_era=" + era + " and nominator='" + nominator + "'";
        query(res, sql);
});

// stake_amount?nominator=
app.get("/stake_amount", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let nominator = q.query.nominator;

        if (!validate_accountid(nominator)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select start_era as era, amount from stakedrop.nominate where nominator= '"+ nominator + "' order by start_era";
        query(res, sql);
});

// stakedrop_point?era=
// stakedrop_point?nominator=&era=
app.get("/stakedrop_point", async function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let nominator = q.query.nominator;
        let era = await query_max_era(q.query.era);

        if (!validate_era(era)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql 
        if  (!validate_accountid(nominator))
                sql = "select sum(point) as total_point, sum(point_est) as total_point_est from stakedrop.stat_point where end_era=" + era;
        else
                sql = "select point, point_est, eras from stakedrop.stat_point where end_era=" + era + " and nominator='" + nominator + "'";
        query(res, sql);
});

// stakedrop_pha?era=
// stakedrop_pha?nominator=&era=
app.get("/stakedrop_pha", async function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let nominator = q.query.nominator;
        let era = await query_max_era(q.query.era);

        if (!validate_era(era)) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql 
        if  (!validate_accountid(nominator))
                sql = "select sum(pha) as total_pha, " + total_stakedrop_pha + " as total_pha_est from stakedrop.stat_pha where end_era=" + era;
        else
                sql = "select pha, pha_est, eras from stakedrop.stat_pha where end_era=" + era + " and nominator='" + nominator + "'";
        query(res, sql);
});

app.get("/stakedrop_time", function(req, res) {
        console.log(req.url);
        
        o = {'status':'ok', 'result':{'start_time': start_time, 'end_time': end_time}};
        res.send(JSON.stringify(o));
});

app.get("/days", function(req, res) {
        console.log(req.url);
        
        let days = Math.round((new Date().getTime() - start_time) / (24 * 60 * 60 * 1000)) + 1;

        o = {'status':'ok', 'result':days};
        res.send(JSON.stringify(o));
});

function query(res, sql) {
        let connection = mysql.createConnection(param);
        connection.query(sql, function (error, results) {
                if (error) {
                        console.log(error);
                        o = {'status':'error'};
                        res.send(JSON.stringify(o));

                        return;
                };
                
                o = {'status':'ok', 'result':results};
                res.send(JSON.stringify(o));
        });
        connection.end();
}

async function query_max_era(era) {
        if (era) return era;

        let result = await new Promise((resolve, reject) => {
                let connection = mysql.createConnection(param);
                connection.query("select max(start_era) as era from stakedrop.nominate", function (error, results) {
                        if (error) {
                                console.log(error);
                                reject([]);
                        };
                        
                        resolve(results);
                });
                connection.end();
        });
        
        return result.length > 0 ? result[0].era : undefined;
}

function validate_era(era) {
        if (era == undefined) return false; 

        let reg = /^\d+$/;
        return reg.test(era);
}

function validate_accountid(account) {
        if (account == undefined) return false; 

        let reg = /^[a-z0-9]+$/i;
        return account.length == 47 && reg.test(account);
}
