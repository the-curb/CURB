# The interview guide and the comprehension test — ready to run, not run

**Decided by the product owner, 20 September 2026: the interviews are not held.** The guide stays on record, unrun. Observed use stands in: the desk's readers, the alert subscriptions people register, and whether holders keep their two tokens once a receipt exists with its cost and risk shown. The risk: the position product proceeds without asking a prospective user; the register's G6 carries that as a decision, not evidence. The blueprint's stop rule (MECHANISM §15) is kept, read against use.

**Status:** Prepared 12 September 2026. Not done: R04 (ten to fifteen conversations with stock-token holders, against the baseline of two tokens in a wallet) and B02 (do people understand the in-kind, fixed-lot, nontransferable offer, and would they choose it again).

**Order of the conversations, decided by the product owner on 17 September 2026 (the dossier's D05):** three data integrators first, as the desk's actual buyers (history and API fan-out); position holders after the desk's first paying use. The beta is three keys.

## Who to talk to

- Holders of several representations of one share (or one issuer's tokens on several chains) who have moved, redeemed, or tried to.
- Allocators who chose an issuer mix on purpose and can say why.
- Integrators or wallet builders who display or account for such tokens.

Not non-holders: this is about behaviour, not interest.

## The conversation (45 minutes)

1. **Holdings**: tokens, issuers, chains, venues, where they sit.
2. **Last move**: what, cost (gas, fees, spread, time), surprises.
3. **Last exit attempt**: venue sale, unwrap, issuer redemption or giving up, and why.
4. **A halt**: an issuer or venue stopping their token; what they did and wanted to do.
5. **The baseline**: show wAAPLx and AAPLon in a wallet; ask what they hold and could do with each; note their words.
6. **The position**: show the series page's simulation labelled **Mock A / Mock B** — one illustrative lot of ten Mock A and twenty Mock B, the receipt, the exit into two claims. Example units, not production quantities of wAAPLx or AAPLon; the named candidates are under research; no pilot lot/cap or holder eligibility is approved. No pitch: read the rules aloud as written, same labels in screenshots and written questions.
7. **The questions that decide it**: (a) What is the receipt, in your words? (b) If A is frozen, what happens to your B? (c) Can you sell the receipt? (d) What does one lot cost you to form and to leave, beside the gas table shown? (e) Would you form one; if so with what; if not, what would have to change?
8. **Cost**: what holding costs them per month today — fees, spreads, time.

## Scoring, per interview

| Field | Values |
| --- | --- |
| Has managed such a position | yes / no |
| Route out they actually used | venue / unwrap / issuer / none |
| Named a halt they lived through | yes / no |
| Described the receipt correctly (proportional right to two components; not a share, not a dollar) | correct / partly / no |
| Answered (b) correctly (B claimable on its own) | correct / no |
| Answered (c) correctly (no; exit is by claim) | correct / no |
| Would form one | yes, with … / no, because … |
| Cost they named for today | number, currency, period |

## The comprehension test (B02), separately

After the interview, unaided, five written questions on the offer as the site states it: the deposit, a lot, whether the receipt transfers, what an exit produces, what happens when one component halts. Pass: five of five. The copy changes until most pass; each change is recorded.

## What the result would replace

Assumption A5 in [the register](ASSUMPTIONS.md) and the *user need* half of gate G6; nothing on the site changes until then. Record answers, comprehension, costs and the separate service-integrator experiment in the [preparation dossier's scorecards](../mainnet/PREPARATION.md#interview-scorecards). This guide supplies no interview result.
