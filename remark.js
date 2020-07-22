// Import
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { TypeRegistry } = require('@polkadot/types');

const init = require("./init");
const query = require("./query_db");

const timer = ms => new Promise( res => setTimeout(res, ms))

//const url = 'ws://localhost:9944';
const url = 'wss://kusama-rpc.polkadot.io';
//const url = 'wss://poc2.phala.network/ws';

const wsProvider = new WsProvider(url);
const registry = new TypeRegistry();
const START_BN = 3270209;
const LAST_BN_KEY = "last_bn";

async function main() {
  
  let start_bn = get_start_block_number(process.argv.slice(2));
  
  registry.register(init.types);

  console.log("connecting ws rpc server at " + url + " ...");
  const api = await ApiPromise.create({ provider: wsProvider, registry});
  console.log("api is ready.");

  while (true) {
    const lastHeader = await api.rpc.chain.getHeader();
    let cur_bn = lastHeader.number.toNumber();
    console.log('current block number:', cur_bn);

    while (cur_bn - 50 > start_bn) {
      const block_hash = await api.rpc.chain.getBlockHash(start_bn);
      console.log("block " + start_bn + "'s hash : " + block_hash.toString());

      try {
        const block = await api.rpc.chain.getBlock(block_hash);
        
        block.block.extrinsics.map((extrinsic, index)=>{
          //console.log(extrinsic)
          const { meta, method, section } = registry.findMetaCall(extrinsic.callIndex);
          if (section === "system" && method  === "remark") {
            handle_remark(extrinsic, start_bn);
          }
        });
      } catch (err) {
        console.log("error: " + err);
      }

      query.query("UPDATE stakedrop.dict set _value = '" + start_bn + "' where _key = '" + LAST_BN_KEY + "'");

      start_bn++;

      await timer(300);
    }

    await timer(60 * 1000);
  }

}

function handle_remark(extrinsic, start_bn) {
  console.log("handle remark extrinsic");
  
  const who = extrinsic.signer.toString();
  
  let remark_hex = extrinsic.args[0].toHex();
  const buf = new Buffer(remark_hex.slice(2), 'hex');
  const remark = buf.toString('utf8');
  if (!remark.startsWith("--phala--") || !remark.endsWith("-phala-")) {
    console.log("not PHALA remark");
    return;
  }

  const eth_address = remark.slice(9, -7);
  if (eth_address.length != 42) {
    console.log("bad eth address");
    return;
  }

  let sql = "select * from stakedrop.eth_address where sub_address = '" + who + "'";
  let result = query.query(sql);
  if (result.length == 0) {
    sql = "insert into stakedrop.eth_address(eth_address, sub_address, block_number) values('" + eth_address + "', '" + who + "', " + start_bn +")";
  } else {
    sql = "update stakedrop.eth_address set eth_address = '" + eth_address + "', block_number = " + start_bn + " where sub_address = '" + who + "'";
  }

  query.query(sql);
}

function get_start_block_number(args) {
  let start_bn = START_BN;
  let result = query.query("SELECT _value from stakedrop.dict where _key='" + LAST_BN_KEY + "'");
  if (args.length >= 1) {
    start_bn = parseInt(args[0]);
    if (result.length == 0) {
      query.query("INSERT INTO stakedrop.dict(_key, _value) values('" + LAST_BN_KEY + "', '" + start_bn + "')");
    }
  } else {
    if (result.length == 1) {
      start_bn = parseInt(result[0]._value);
    } else {
      query.query("INSERT INTO stakedrop.dict(_key, _value) values('" + LAST_BN_KEY + "', '" + start_bn + "')");
    }
  }

  return start_bn;
}

main().catch(console.error).finally(() => process.exit());
