const query = require("./query_db");
const constants = require("./constants");
const execSync = require('child_process').execSync;

const timer = ms => new Promise( res => setTimeout(res, ms));

const LEVEL1 = 30; //day
//const LEVEL2 = LEVEL1 * 2;
const LEVEL3 = LEVEL1 * 3;

const ERAS_PER_DAY = 4;
const PHA_SUPPLY = 27000000;
const MAX_POINT = 14715243;

/*function calc_rank(day) {
  if (day < LEVEL1) return 0;
  if (day > LEVEL3) day = LEVEL3;
  return (day/LEVEL1) * Math.pow(1.01, day - LEVEL1);
}

let rank = calc_rank(90);
console.log(rank);
*/

function calc_point(eras, value) {
  if (eras < ERAS_PER_DAY * LEVEL1) return 0;
  if (eras > ERAS_PER_DAY * LEVEL3) eras = ERAS_PER_DAY * LEVEL3;

  //return eras / 4 /30 * Math.pow(1.01, (eras - 120) / 4 * value;
  return eras / (ERAS_PER_DAY  * LEVEL1 ) * Math.pow(1.01, (eras - ERAS_PER_DAY * LEVEL1) / ERAS_PER_DAY) * value;
}

function get_point(nominator, end_era) {
  if (end_era >= constants.START_ERA + ERAS_PER_DAY * LEVEL3) {
    //end_era = constants.START_ERA + LEVEL3 - 1;
    return;
  }

  let data = [];
  let amounts = query.query("select amount from stakedrop.nominate where nominator='" + nominator + "' and start_era>=" + constants.START_ERA + " and start_era <=" + end_era + " and amount >= " + constants.MIN_NOMINATE * constants.UNIT);
  for (i in amounts) {
    data.push(amounts[i].amount);
  }

  let data_len = data.length;
  if (data_len == 0) return;

  if (data_len < ERAS_PER_DAY * LEVEL1) {
    //estimate points
    let len = data_len;
    if (len < ERAS_PER_DAY * LEVEL1) {
      let avg_val = Math.floor(data.reduce((acc, ele)=> acc + ele) / len);
      while (len < ERAS_PER_DAY * LEVEL1) {
        data.push(avg_val);
        len++;
      }
    }
  }

  //console.log("data: " + JSON.stringify(data));

  let segments = [];
  while (data.length > 0) {
    let eras = data.length;
    let val = Math.min.apply(Math, data);
    segments.push({eras: eras, value: val});
    
    let tmp = [];
    for (i in data) {
      if (data[i] >= val + constants.MIN_NOMINATE*constants.UNIT) {
        tmp.push(data[i]-val);
      }
    }

    data = tmp;
  }
  //console.log("segments: " + JSON.stringify(segments));

  let points_est = 0.0;
  for (i in segments) {
    points_est += calc_point(segments[i].eras, segments[i].value/constants.UNIT);
  }

  let points = 0;
  if (data_len >= ERAS_PER_DAY * LEVEL1) points = points_est;
  query.query("INSERT into stakedrop.stat_point(nominator, eras, point, point_est, start_era, end_era) values('" + nominator + "', " + data_len + ", " + Math.round(points)+ ", " + Math.round(points_est) + ", " + constants.START_ERA + ", " + end_era + ")");

  console.log(nominator + "'s points: " + points + ", estimate points: " + points_est);

  return;
}

function get_max_era() {
  let result = query.query("SELECT max(start_era) as max_era FROM stakedrop.nominate");
  return result[0].max_era == null ? 0 : result[0].max_era;
}

function get_pha(end_era) {
  let result = query.query("SELECT sum(point) as points, sum(point_est) as points_est from stakedrop.stat_point where end_era=" + end_era);
  let total_points = result[0].points;
  let total_est_points = result[0].points_est;
  if (total_points == null) return;
  if (total_points > MAX_POINT)
    total_points = MAX_POINT;
  console.log("totoal points: " + total_points);
  console.log("totoal estimate points: " + total_est_points);
  result = query.query("SELECT nominator, point, point_est, eras from stakedrop.stat_point where end_era=" + end_era);
  for (i in result) {
    let nominator = result[i].nominator;
    let eras = result[i].eras;
    let point = result[i].point;
    let point_est = result[i].point_est;
    let pha = total_points == 0 ? 0 : Math.round(point * PHA_SUPPLY / total_points);
    let pha_est = total_est_points == 0 ? 0 : Math.round(point_est * PHA_SUPPLY / total_est_points);

    query.query("INSERT INTO stakedrop.stat_pha(nominator, end_era, pha, pha_est, start_era, eras) values('" + nominator + "', " + end_era + ", " + pha + ", " + pha_est  + ", " + constants.START_ERA + ", " + eras + ")");
  }
}

async function main() {
  let args = process.argv.slice(2)
  if (args.length >= 1 && args[0] == "init") {
    query.query("DELETE from stakedrop.stat_point");
    query.query("DELETE from stakedrop.stat_pha");

    return;
  }

  let end_era = constants.START_ERA;
  if (args.length >= 1) {
    end_era = parseInt(args[0]);
  } else {
    let result1 = query.query("SELECT max(end_era) as end_era from stakedrop.stat_point");
    let result2 = query.query("SELECT max(end_era) as end_era from stakedrop.stat_pha");
    end_era = result1[0].end_era > result2[0].end_era ? result2[0].end_era : result1[0].end_era;
    if (end_era == undefined) end_era = constants.START_ERA;
  }

  query.query("DELETE from stakedrop.stat_point where end_era >=" + end_era);
  query.query("DELETE from stakedrop.stat_pha where end_era >=" + end_era);

  let loop = 0;
  while (true) {
    let max_era = get_max_era();
    console.log("\nend era: " + end_era + ", max era: " + max_era + ", loop: " + loop);
    if (end_era <= max_era) {
      let result = query.query("select _value from stakedrop.dict where _key = '" + constants.NOMINATE_LOCK_KEY + "'");
      if (result.length == 1 && parseInt(result[0]._value) != end_era) {
        let nominators = query.query("select distinct nominator from stakedrop.nominate where start_era>=" + constants.START_ERA + " and start_era <=" + end_era);
        for (i in nominators) {
          let nominator = nominators[i].nominator;
          get_point(nominator, end_era);
        }

        get_pha(end_era);

        end_era++;
        if (end_era >= constants.START_ERA +  ERAS_PER_DAY * LEVEL3) break;

        loop = 0;
        await timer(1000);
      }
    } else {
      let result = query.query("select _value from stakedrop.dict where _key = '" + constants.NOMINATE_HEARTBEAT_KEY + "'");
      if (result.length == 1 && new Date().getTime() - result[0]._value > 15 * 60 * 1000) {
        const output = execSync('sudo systemctl restart lockdrop_nominate', { encoding: 'utf-8' });
        console.log('restart nominate service: ', output);
      }
      
      loop++;
      await timer(1000 * 60 * 5);
    }
  }
} 

main()


