# The interview guide and the comprehension test — ready to run, not run

**Decided by the product owner, 20 September 2026: the interviews are not held.** The guide stays on the record as the instrument it is, and is not run. What stands in place of the conversations is observed use — the desk's readers, the alert subscriptions people pay for once the desk is configured, and whether holders keep their two tokens once a receipt exists with its cost and risk in front of them — with the risk named: the position product proceeds without a prospective user having been asked, and the register's G6 carries that as a decision, not as evidence. The blueprint's stop rule (MECHANISM §15) is kept and read against use instead of interviews.

**Status:** Prepared 12 September 2026. Blueprint R04 asks for ten to fifteen conversations with people who already hold stock tokens, against the baseline of two tokens in a wallet; B02 asks whether people understand the in-kind, fixed-lot, nontransferable offer and would choose it again. Neither has been done. This page is the instrument, so that the result — when there is one — is comparable across interviews and cannot be steered.

**Order of the conversations, decided by the product owner on 17 September 2026 (the dossier's D05):** the first three people to talk to are data integrators — the desk's actual buyers, who would pay for its history and fan-out over the API — and they come before the position-holder conversations below, which follow the desk's first paying use rather than precede it. The beta is three keys.

## Who to talk to

- Holders of more than one representation of the same share (or of the same issuer's tokens on more than one chain), who have moved, redeemed, or tried to.
- Allocators who chose an issuer mix on purpose and can say why.
- Integrators or wallet builders who have had to display or account for such tokens.

Not: people who hold none and would like to; the interview is about behaviour, not interest.

## The conversation (45 minutes)

1. **What you hold and how you got it.** Which tokens, which issuers, which chains, through which venues. Where the tokens sit now.
2. **The last time you moved one.** What you did, what it cost (gas, fees, spread, time), what surprised you.
3. **The last time you tried to leave one.** Sold on a venue, unwrapped, redeemed with the issuer, or gave up — and why that route.
4. **A halt.** Has an issuer or a venue ever stopped a token you held? What did you do; what did you want to do.
5. **The baseline.** Show two tokens in a wallet: wAAPLx and AAPLon. Ask them to describe what they hold and what they could do with each. Note every word they use for it.
6. **The position.** Show the series page's simulation labelled **Mock A / Mock B**: one illustrative lot of ten Mock A and twenty Mock B, the receipt, and the exit into two claims. These are example units, not production quantities of wAAPLx or AAPLon. The named candidates in the baseline are under research; no pilot lot/cap or holder eligibility has been approved. No pitch: read the rules aloud, as written, and keep the same labels in screenshots and written questions.
7. **The questions that decide it.** (a) What is the receipt, in your words? (b) If A is frozen, what happens to your B? (c) Can you sell the receipt? (d) What does one lot cost you to form and to leave, beside the gas table shown? (e) Would you form one; if so with what; if not, what would have to change.
8. **Cost.** What they pay today per month for holding as they do — fees, spreads, their own time.

## Scoring, per interview

| Field | Values |
| --- | --- |
| Has managed such a position | yes / no |
| Route out they actually used | venue / unwrap / issuer / none |
| Named a halt they lived through | yes / no |
| Described the receipt correctly (a proportional right to two components, not a share, not a dollar) | correct / partly / no |
| Answered (b) correctly (B is claimable on its own) | correct / no |
| Answered (c) correctly (no; exit is by claim) | correct / no |
| Would form one | yes, with … / no, because … |
| Cost they named for today | number, currency, period |

## The comprehension test (B02), separately

After the interview, without the interviewer's help, five written questions on the offer as the site states it: what the deposit is, what a lot is, whether the receipt transfers, what an exit produces, and what happens when one component halts. A pass is five of five; the offer's copy is changed until most participants pass, and the change is recorded.

## What the result would replace

Assumption A5 in [the register](ASSUMPTIONS.md), and the *user need* half of gate G6. Nothing on the site changes until then.

Use the [preparation dossier's scorecards](../mainnet/PREPARATION.md#interview-scorecards) to record original answers, comprehension, costs and the separate service-integrator experiment. No interview result is supplied by this guide.
