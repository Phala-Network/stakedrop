const { ApiPromise, WsProvider } = require('@polkadot/api');
const { TypeRegistry } = require('@polkadot/types');
const { hexToNumber, bnToHex, isBn } = require('@polkadot/util');
const { encodeAddress, decodeAddress } = require('@polkadot/util-crypto');

const query = require("./query_db");
const init = require("./init");
const constants = require("./constants");
const timer = ms => new Promise( res => setTimeout(res, ms));

const append = true;
//const url = 'ws://localhost:9944';
const url = 'wss://kusama-rpc.polkadot.io';
const wsProvider = new WsProvider(url);
const registry = new TypeRegistry();
registry.register(init.types);

const LAST_ERA_KEY = 'last_era';

async function main() {
  let isKusama = url.indexOf("kusama") > 0;
  console.log("isKusama: " + isKusama);

  let args = process.argv.slice(2)

  if (args.length >= 1 && args[0] == "init") {
    init_db();
    return;
  }

  let start_era_number;
  if (!append) {
    init_db();
    start_era_number = get_start_era_number(args);
  } else {
    start_era_number = get_start_era_number(args);
    query.query("DELETE from stakedrop.nominate where start_era >= " + start_era_number);
    query.query("DELETE from stakedrop.staker where era >= " + start_era_number);
  }

  const api = await ApiPromise.create({ provider: wsProvider, registry});
  console.log("api is ready.");

  const block_time = api.consts.babe.expectedBlockTime.toNumber();
  const epoch_duration = api.consts.babe.epochDuration.toNumber();
  const sessions_per_era = api.consts.staking.sessionsPerEra.toNumber();
  const era_duration = epoch_duration * sessions_per_era;
  console.log("era duration: " + era_duration);

  let whitelist = get_whitelist(isKusama);
  console.log(whitelist);
  if (whitelist.length == 0) {
    console.log('no whitelist defined.')
    return;
  }

  let result = query.query("select _value from stakedrop.dict where _key = '" + constants.NOMINATE_LOCK_KEY + "'");
  if (result == 0) query.query("INSERT into stakedrop.dict(_key, _value) values('" + constants.NOMINATE_LOCK_KEY + "', 0)");

  let loop = 0;
  while (true) {
    let cur_era_number;
    try {
      let cur_era = await api.query.staking.currentEra();
      if (isBn(cur_era))
        cur_era_number = hexToNumber(bnToHex(cur_era));
      else {
        cur_era_number = cur_era._raw.toNumber();
      }
      console.log("\nstart era: " + start_era_number + ", current era: " + cur_era_number + ", loop: " + loop);
    } catch (error) {
      console.log('error:', error);
      await timer(1000 * 60);
      continue;
    }
    
    query.query("UPDATE stakedrop.dict set _value = 0 where _key = '" + constants.NOMINATE_LOCK_KEY + "'");

    if (start_era_number <= cur_era_number) {
      query.query("UPDATE stakedrop.dict set _value = " + start_era_number + " where _key = '" + constants.NOMINATE_LOCK_KEY + "'");
      
      let history_depth = (await api.query.staking.historyDepth()).toNumber();
      let block_hash;
      let archived = false;
      if (isKusama) archived = cur_era_number - start_era_number > history_depth;
      if (archived) {
        let result = query.query("select hash from stakedrop.era_first_block where era=" + start_era_number);
        if (result.length == 0) {
          break;
        }
        block_hash = result[0].hash;
        console.log("block hash: " + block_hash.toString());
        let block_era = await api.query.staking.currentEra.at(block_hash);
        let block_era_number = block_era._raw.toNumber();
        console.log("block era: " + block_era_number);
        if (block_era_number != start_era_number) {
          console.log("era number not matched");
          break;
        }
      }

      //read state from chain
      let array = await read_state(api, whitelist, archived, block_hash, start_era_number, isKusama);

      if (append)
        insert_state(array, start_era_number);
      else
        merge_state(array, start_era_number);

      //
      query.query("UPDATE stakedrop.dict set _value = '" + start_era_number + "' where _key = '" + LAST_ERA_KEY + "'");

      start_era_number ++;
      loop = 0;
      await timer(1000);
    } else {
      loop++;
      if (isKusama)
        await timer(1000 * 60 * 5); //query every 5 minutes
      else 
        await timer(block_time * era_duration / 3);
    }
  }
}

async function read_state(api, whitelist, archived, block_hash, start_era_number, isKusama) {
  let array = [];
  for (index in whitelist) {
    let nominee = whitelist[index].stash;
    console.log('nominee: ' + nominee);
    let stakers
    if (archived) {
      stakers = await api.query.staking.erasStakers.at(block_hash, start_era_number, nominee);
    } else {
      stakers = await api.query.staking.erasStakers(start_era_number, nominee);
    }
    let self_stake_amount = parse_human_string(stakers.own.toHuman()) * constants.UNIT;
    array.push({nominator: nominee, nominee: nominee, amount: self_stake_amount, flag: 0});
    query.query("Insert into stakedrop.staker(nominee, nominator, amount, era) values('" + nominee + "', '" + nominee + "',  " + self_stake_amount + ", " + start_era_number + ")");

    if (stakers.others.length > 0) {
      for (index1 in stakers.others) {
        if (stakers.others[index1].who != undefined) {
          let prefix = isKusama ? 2 : 42;
          let nominator = encodeAddress(stakers.others[index1].who, prefix);
          let amount = parse_human_string(stakers.others[index1].value._raw.toHuman()) * constants.UNIT;
          console.log(nominator + ' nominate to ' + nominee + ': ' + amount);
          query.query("Insert into stakedrop.staker(nominee, nominator, amount, era) values('" + nominee + "', '" + nominator + "',  " + amount + ", " + start_era_number + ")");

          let found = false;
          for (let i in array) {
            if (array[i].nominator == nominator) {
              array[i].amount += amount;
              array[i].nominee += ',' + nominee;
              found = true;
              break;
            }
          }
          if (!found) {
            array.push({nominator: nominator, nominee: nominee, amount: amount, flag: 0});
          }
        }
      }
    }
  }

  return array;
}

function parse_human_string(amount_str) {
  let amount = 0;
  amount_str = amount_str.split(' ')[0];
  if (amount_str.endsWith("k")) {
    amount = Math.round(parseFloat(amount_str.slice(0, -1)) * 1000);
  } else if (amount_str.endsWith("m")) {
    amount = Math.round(parseFloat(amount_str.slice(0, -1)) * 1e6);
  } else {
    amount = Math.round(parseFloat(amount_str));
  }

  return amount;
}

function insert_state(array, start_era_number) {
  for (index in array) {
    let amount = array[index].amount;
    if (amount > 0) {
      let nominator = array[index].nominator;
      let nominee = array[index].nominee;
      
      insert_nominate(nominator, nominee, amount, start_era_number);
    }
  }
}

function merge_state(array, start_era_number) {
  //merge state into db
  let sql = "select nominator, amount, start_era from stakedrop.nominate where end_era = 0";
  let result = query.query(sql);
  if (array.length > 0) {
    for (index in result) {
      let found = false;
      let nominator = result[index].nominator;
      let amount = result[index].amount;
      for (index1 in array) {
        if (array[index1].nominator == nominator) {
          let new_amount = array[index1].amount;
          let nominee = array[index1].nominee;
          if (Math.abs(new_amount - amount) > constants.UNIT) {
            //nominate amount changed
            update_nominate(nominator, start_era_number);

            if (new_amount >= constants.UNIT * constants.MIN_NOMINATE) {
              insert_nominate(nominator, nominee, new_amount, start_era_number);
            }
          } 

          array[index1].flag = 1;
          found = true;
          break;
        }
      }
      if (!found) {
        update_nominate(nominator, start_era_number);
      }
    }

    for (index2 in array) {
      if (array[index2].flag == 0) { //new nominate
        let nominator = array[index2].nominator;
        let nominee = array[index2].nominee;
        let amount = array[index2].amount;
        if (amount >= constants.UNIT * constants.MIN_NOMINATE) {
          insert_nominate(nominator, nominee, amount, start_era_number);
        }
      }
    }
  } else {
    console.log("*** no nomination found in whitelist.");
    for (index in result) {
      let nominator = result[index].nominator;
      update_nominate(nominator, start_era_number);
    }
  } 
}

function get_whitelist(isKusama) {
  let sql = "SELECT stash from stakedrop.whitelist where stash ";
  if (isKusama) {
    sql += " not ";
  }
  sql += " like '5%'";

  let result = query.query(sql);
  return result;
}

function insert_nominate(nominator, nominee, amount, start_era_number) {
  //let sql = "SELECT id from stakedrop.nominate where nominator = '" + nominator + "' and start_era = " + start_era_number;
  //if (query.query(sql).length == 1) return;

  let sql = "INSERT INTO stakedrop.nominate(nominator, nominee, amount, start_era) values('" + nominator + "', '" + nominee + "', " + amount + ", " + start_era_number + ")";
  if (query.query(sql)) {
    console.log("add nominate ok");
  } else {
    console.log("add nominate err");
  }
}

function update_nominate(nominator, start_era_number) {
  //let sql = "SELECT id from stakedrop.nominate where nominator = '" + nominator + "' and start_era = " + start_era_number;
  //if (query.query(sql).length == 1) return;

  query.query("UPDATE stakedrop.nominate set end_era=" + start_era_number + " where nominator='" + nominator + "' and end_era = 0");
}

function init_db() {
  query.query("DELETE from stakedrop.nominate");
  query.query("DELETE from stakedrop.staker");
  query.query("DELETE from stakedrop.dict");
}

function get_start_era_number(args) {
  let start_era = constants.START_ERA - 1; //1 era earlier than statistics 
  let result = query.query("SELECT _value from stakedrop.dict where _key='" + LAST_ERA_KEY + "'");
  if (args.length >= 1) {
    start_era = parseInt(args[0]);
    if (result.length == 0) {
      query.query("INSERT INTO stakedrop.dict(_key, _value) values('" + LAST_ERA_KEY + "', '" + start_era + "')");
    }
  } else {
    if (result.length == 1) {
      start_era = parseInt(result[0]._value);
    } else {
      query.query("INSERT INTO stakedrop.dict(_key, _value) values('" + LAST_ERA_KEY + "', '" + start_era + "')");
    }
  }

  return start_era;
}


main().catch(console.error).finally(() => process.exit());


