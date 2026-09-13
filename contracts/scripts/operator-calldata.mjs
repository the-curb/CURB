/**
 * The operator's transactions, as bytes for the multisig to sign (blueprint
 * O01). Nothing here sends anything or holds a key: it prints `to` and
 * `data` for one operator action on one series, with the reason string the
 * policy requires carried into the transaction where the contract records
 * it. Selectors are derived from the contract's ABI, never remembered.
 *
 *   node scripts/operator-calldata.mjs <series address> mint-permit  <holder> <until unix seconds>
 *   node scripts/operator-calldata.mjs <series address> claim-permit <holder> <true|false>
 *   node scripts/operator-calldata.mjs <series address> pause-mint   <true|false> "<reason>"
 *   node scripts/operator-calldata.mjs <series address> pause-claims <A|B> <true|false> "<reason>"
 *   node scripts/operator-calldata.mjs <series address> transfer-operator <next operator>
 *   node scripts/operator-calldata.mjs <series address> cancel-operator-transfer
 *   node scripts/operator-calldata.mjs <series address> accept-operator
 */
import { readFileSync } from 'node:fs';
import { encodeFunctionData } from 'viem';

const [series, action, ...rest] = process.argv.slice(2);
const usage = () => {
  console.error('usage: node scripts/operator-calldata.mjs <series> <mint-permit|claim-permit|pause-mint|pause-claims|transfer-operator|cancel-operator-transfer|accept-operator> …');
  process.exit(2);
};
if (!series || !/^0x[0-9a-fA-F]{40}$/.test(series) || !action) usage();

const abi = JSON.parse(readFileSync(new URL('../artifacts/src/CompanySeries.sol/CompanySeries.json', import.meta.url), 'utf8')).abi;
const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const bool = (v) => (v === 'true' ? true : v === 'false' ? false : usage());
const component = (v) => (v === 'A' ? 0 : v === 'B' ? 1 : usage());
const reason = (v) => {
  if (typeof v !== 'string' || v.trim().length < 8) {
    console.error('refused: a stop or a resume carries a reason of at least eight characters; the contract records it');
    process.exit(1);
  }
  return v;
};

let functionName;
let args;
let says;
switch (action) {
  case 'mint-permit': {
    const [holder, until] = rest;
    if (!isAddress(holder) || !/^[0-9]+$/.test(until ?? '')) usage();
    functionName = 'setMintPermit';
    args = [holder, BigInt(until)];
    says = `let ${holder} mint until unix time ${until} (${new Date(Number(until) * 1000).toISOString()})`;
    break;
  }
  case 'claim-permit': {
    const [holder, permitted] = rest;
    if (!isAddress(holder)) usage();
    functionName = 'setClaimPermit';
    args = [holder, bool(permitted)];
    says = `${bool(permitted) ? 'let' : 'no longer let'} ${holder} claim`;
    break;
  }
  case 'pause-mint': {
    const [paused, why] = rest;
    functionName = 'setMintPaused';
    args = [bool(paused), reason(why)];
    says = `${bool(paused) ? 'stop' : 'resume'} minting — ${why}`;
    break;
  }
  case 'pause-claims': {
    const [which, paused, why] = rest;
    functionName = 'setClaimPaused';
    args = [component(which), bool(paused), reason(why)];
    says = `${bool(paused) ? 'stop' : 'resume'} claims of ${which} — ${why}`;
    break;
  }
  case 'transfer-operator': {
    const [next] = rest;
    if (rest.length !== 1 || !isAddress(next) || /^0x0{40}$/i.test(next)) usage();
    functionName = 'transferOperator';
    args = [next];
    says = `nominate ${next}; the current operator keeps authority until the nominee executes acceptOperator()`;
    break;
  }
  case 'cancel-operator-transfer': {
    if (rest.length !== 0) usage();
    functionName = 'cancelOperatorTransfer';
    args = [];
    says = 'cancel the pending nomination; the current operator keeps authority';
    break;
  }
  case 'accept-operator': {
    if (rest.length !== 0) usage();
    functionName = 'acceptOperator';
    args = [];
    says = 'the pending operator accepts from its own address (through its Safe quorum); the former operator then loses authority';
    break;
  }
  default:
    usage();
}

const data = encodeFunctionData({ abi, functionName, args });
console.log(JSON.stringify({ to: series.toLowerCase(), data, functionName, args: args.map((a) => (typeof a === 'bigint' ? a.toString() : a)), says, requiredSender: action === 'accept-operator' ? 'pending operator' : 'current operator', note: 'verify the current and pending addresses on chain before signing; this desk sends nothing and holds no key' }, null, 2));
