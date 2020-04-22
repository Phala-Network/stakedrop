const http = require('http');
const https = require('https');
const express = require("express");  
const app = express();  
const url = require('url')

const mysql = require('mysql');
const param = {
        host     : 'localhost',
        user     : 'root',
        password : '12345678',
        port     : 3306
}
 
let httpServer = http.createServer(app);
httpServer.listen(8888)

// wihtelist
// wihtelist?stash=
app.get("/whitelist", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let stash = q.query.stash;

        let sql = "select * from stakedrop.whitelist";
        if (stash == undefined)
                sql += " where stash not like '5%'"
        else
                sql += " where stash = '" + stash + "'";
        query(res, sql);
});

// whitelist_stake_sum?stash=&era=
app.get("/whitelist_stake_sum", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let stash = q.query.stash;
        let era = q.query.era;

        if (era == undefined || stash == undefined) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select count(*) as count, sum(amount) as amount from stakedrop.staker where nominee='" + stash + "' and era=" + era;
        query(res, sql);
});

// whitelist_stake_info?stash=&era=
app.get("/whitelist_stake_info", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let stash = q.query.stash;
        let era = q.query.era;

        if (era == undefined || stash == undefined) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select nominator, amount from stakedrop.staker where nominee='" + stash + "' and era=" + era;
        query(res, sql);
});

// nominators?era=
app.get("/nominators", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let era = q.query.era;

        if (era == undefined) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select nominator from stakedrop.nominate where start_era=" + era;
        query(res, sql);
});

// staking_info?nominator=&era=
app.get("/staking_info", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let nominator = q.query.nominator;
        let era = q.query.era;

        if (era == undefined || nominator == undefined) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select nominator, nominee, amount from stakedrop.nominate where start_era=" + era + " and nominator='" + nominator + "'";
        query(res, sql);
});

// stakedrop_pha?nominator=&era=
app.get("/stakedrop_pha", function(req, res) {
        console.log(req.url);
        let q = url.parse(req.url, true);
        let nominator = q.query.nominator;
        let era = q.query.era;

        if (era == undefined || nominator == undefined) {
                o = {'status':'error'};
                res.send(JSON.stringify(o));

                return;
        }

        let sql = "select nominator, pha, pha_est from stakedrop.stat_pha where end_era=" + era + " and nominator='" + nominator + "'";
        query(res, sql);
});

function query(res, sql) {
        let connection = mysql.createConnection(param)
        connection.query(sql, function (error, results, fields) {
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
