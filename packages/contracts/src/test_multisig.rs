#![cfg(test)]
//! Tests for the M-of-N oracle (`approve_delivery`), proportional dispute splits and evidence.

use crate::{
    EscrowError, EscrowStatus, OracleSet, TitipEscrowContract, TitipEscrowContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token, vec, Address, BytesN, Env, String, Vec,
};

const FIFTY_USDC: i128 = 500_000_000;
const DEFAULT_TIMEOUT: u32 = 100_000 + 51_840;
const BUYER_START: i128 = 10_000_000_000;

struct Setup<'a> {
    env: Env,
    contract: TitipEscrowContractClient<'a>,
    admin: Address,
    oracle: Address,
    buyer: Address,
    seller: Address,
    token: Address,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 27,
        sequence_number: 100_000,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    let contract_id = env.register_contract(None, TitipEscrowContract);
    let contract = TitipEscrowContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    token::StellarAssetClient::new(&env, &token).mint(&buyer, &BUYER_START);

    contract.initialize(&admin, &oracle, &token);

    Setup { env, contract, admin, oracle, buyer, seller, token }
}

/// Funded and shipped escrow of `amount`.
fn shipped(s: &Setup, amount: i128) -> u64 {
    let id = s.contract.create_escrow(&s.buyer, &s.seller, &amount, &DEFAULT_TIMEOUT);
    s.contract.fund(&id);
    s.contract.submit_tracking(
        &id,
        &String::from_str(&s.env, "JT1234567890"),
        &String::from_str(&s.env, "jnt"),
    );
    id
}

fn disputed(s: &Setup, amount: i128) -> u64 {
    let id = shipped(s, amount);
    s.contract.dispute_escrow(&id, &s.buyer);
    id
}

fn three_oracles(s: &Setup, threshold: u32) -> (Address, Address, Address) {
    let (a, b, c) = (
        Address::generate(&s.env),
        Address::generate(&s.env),
        Address::generate(&s.env),
    );
    s.contract.set_oracles(&vec![&s.env, a.clone(), b.clone(), c.clone()], &threshold);
    (a, b, c)
}

fn hash(s: &Setup, byte: u8) -> BytesN<32> {
    BytesN::from_array(&s.env, &[byte; 32])
}

fn balance(s: &Setup, who: &Address) -> i128 {
    token::Client::new(&s.env, &s.token).balance(who)
}

// ============================================================================
// Legacy behaviour is untouched
// ============================================================================

#[test]
fn test_no_oracle_set_by_default() {
    let s = setup();
    assert_eq!(s.contract.get_oracle_set(), None);
}

#[test]
fn test_single_oracle_can_approve_when_no_set_configured() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    assert!(s.contract.approve_delivery(&id, &s.oracle));
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Delivered);
    assert_eq!(balance(&s, &s.seller), FIFTY_USDC);
}

// ============================================================================
// M-of-N delivery
// ============================================================================

#[test]
fn test_two_of_three_releases_only_on_second_distinct_approval() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    let (a, b, _c) = three_oracles(&s, 2);

    assert!(!s.contract.approve_delivery(&id, &a));
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Shipped);
    assert_eq!(balance(&s, &s.seller), 0);
    assert_eq!(s.contract.get_delivery_approvals(&id).len(), 1);

    assert!(s.contract.approve_delivery(&id, &b));
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Delivered);
    assert_eq!(balance(&s, &s.seller), FIFTY_USDC);
    assert_eq!(balance(&s, &s.contract.address), 0);
    // Approvals are cleaned up after the payout.
    assert_eq!(s.contract.get_delivery_approvals(&id).len(), 0);
}

#[test]
fn test_same_oracle_approving_twice_does_not_reach_the_threshold() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    let (a, _b, _c) = three_oracles(&s, 2);

    assert!(!s.contract.approve_delivery(&id, &a));
    assert!(!s.contract.approve_delivery(&id, &a));
    assert!(!s.contract.approve_delivery(&id, &a));

    assert_eq!(s.contract.get_delivery_approvals(&id).len(), 1);
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Shipped);
    assert_eq!(balance(&s, &s.seller), 0);
}

#[test]
fn test_three_of_three_needs_everyone() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    let (a, b, c) = three_oracles(&s, 3);

    assert!(!s.contract.approve_delivery(&id, &a));
    assert!(!s.contract.approve_delivery(&id, &b));
    assert_eq!(balance(&s, &s.seller), 0);
    assert!(s.contract.approve_delivery(&id, &c));
    assert_eq!(balance(&s, &s.seller), FIFTY_USDC);
}

#[test]
fn test_outsider_cannot_approve() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    three_oracles(&s, 2);

    let outsider = Address::generate(&s.env);
    assert_eq!(s.contract.try_approve_delivery(&id, &outsider), Err(Ok(EscrowError::Unauthorized)));
    // The old single oracle is no longer part of the set either.
    assert_eq!(s.contract.try_approve_delivery(&id, &s.oracle), Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_buyer_and_seller_cannot_approve_their_own_delivery() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    three_oracles(&s, 1);
    assert_eq!(s.contract.try_approve_delivery(&id, &s.seller), Err(Ok(EscrowError::Unauthorized)));
    assert_eq!(s.contract.try_approve_delivery(&id, &s.buyer), Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_confirm_delivery_cannot_bypass_the_threshold_once_a_set_exists() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    three_oracles(&s, 2);

    assert_eq!(s.contract.try_confirm_delivery(&id), Err(Ok(EscrowError::Unauthorized)));
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Shipped);
    assert_eq!(balance(&s, &s.seller), 0);
}

#[test]
fn test_approve_requires_a_shipped_escrow() {
    let s = setup();
    let (a, _b, _c) = three_oracles(&s, 1);

    // Funded but not shipped.
    let id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&id);
    assert_eq!(s.contract.try_approve_delivery(&id, &a), Err(Ok(EscrowError::InvalidStatus)));

    // Already delivered.
    let id2 = shipped(&s, FIFTY_USDC);
    assert!(s.contract.approve_delivery(&id2, &a));
    assert_eq!(s.contract.try_approve_delivery(&id2, &a), Err(Ok(EscrowError::InvalidStatus)));

    // Unknown escrow.
    assert_eq!(s.contract.try_approve_delivery(&999, &a), Err(Ok(EscrowError::EscrowNotFound)));
}

#[test]
fn test_disputed_and_refunded_escrows_cannot_be_approved() {
    let s = setup();
    let (a, _b, _c) = three_oracles(&s, 1);
    let id = disputed(&s, FIFTY_USDC);
    assert_eq!(s.contract.try_approve_delivery(&id, &a), Err(Ok(EscrowError::InvalidStatus)));

    let id2 = shipped(&s, FIFTY_USDC);
    s.env.ledger().with_mut(|l| l.sequence_number = DEFAULT_TIMEOUT + 1);
    s.contract.claim_refund(&id2);
    assert_eq!(s.contract.try_approve_delivery(&id2, &a), Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_removed_oracle_approval_no_longer_counts() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    let (a, b, c) = three_oracles(&s, 2);

    assert!(!s.contract.approve_delivery(&id, &a));
    // `a` is removed; its stored approval must not count towards the new 2-of-2.
    s.contract.set_oracles(&vec![&s.env, b.clone(), c.clone()], &2);

    assert!(!s.contract.approve_delivery(&id, &b));
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Shipped);
    assert!(s.contract.approve_delivery(&id, &c));
    assert_eq!(balance(&s, &s.seller), FIFTY_USDC);
}

#[test]
fn test_lowering_the_threshold_lets_a_repeat_call_complete_the_delivery() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    let (a, b, c) = three_oracles(&s, 3);

    assert!(!s.contract.approve_delivery(&id, &a));
    s.contract.set_oracles(&vec![&s.env, a.clone(), b, c], &1);

    // `a` already approved: calling again re-evaluates and releases.
    assert!(s.contract.approve_delivery(&id, &a));
    assert_eq!(balance(&s, &s.seller), FIFTY_USDC);
}

#[test]
fn test_update_oracle_drops_the_set_and_restores_single_oracle_mode() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    three_oracles(&s, 2);
    assert!(s.contract.get_oracle_set().is_some());

    let new_oracle = Address::generate(&s.env);
    s.contract.update_oracle(&new_oracle);

    assert_eq!(s.contract.get_oracle_set(), None);
    s.contract.confirm_delivery(&id);
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Delivered);
}

#[test]
fn test_set_oracles_validation() {
    let s = setup();
    let (a, b, c) = (
        Address::generate(&s.env),
        Address::generate(&s.env),
        Address::generate(&s.env),
    );
    let none: Vec<Address> = Vec::new(&s.env);

    assert_eq!(s.contract.try_set_oracles(&none, &1), Err(Ok(EscrowError::InvalidOracleSet)));
    assert_eq!(
        s.contract.try_set_oracles(&vec![&s.env, a.clone(), b.clone()], &0),
        Err(Ok(EscrowError::InvalidOracleSet))
    );
    assert_eq!(
        s.contract.try_set_oracles(&vec![&s.env, a.clone(), b.clone()], &3),
        Err(Ok(EscrowError::InvalidOracleSet))
    );
    assert_eq!(
        s.contract.try_set_oracles(&vec![&s.env, a.clone(), a.clone(), c.clone()], &2),
        Err(Ok(EscrowError::InvalidOracleSet))
    );

    let mut eleven: Vec<Address> = Vec::new(&s.env);
    for _ in 0..11 {
        eleven.push_back(Address::generate(&s.env));
    }
    assert_eq!(s.contract.try_set_oracles(&eleven, &6), Err(Ok(EscrowError::InvalidOracleSet)));

    // Nothing was stored by the rejected calls.
    assert_eq!(s.contract.get_oracle_set(), None);

    // Boundary: 10 oracles with threshold 10 is fine.
    let mut ten: Vec<Address> = Vec::new(&s.env);
    for _ in 0..10 {
        ten.push_back(Address::generate(&s.env));
    }
    s.contract.set_oracles(&ten, &10);
    assert_eq!(s.contract.get_oracle_set(), Some(OracleSet { oracles: ten, threshold: 10 }));
}

#[test]
fn test_oracle_in_the_set_can_open_a_dispute_and_a_removed_one_cannot() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    let (a, b, c) = three_oracles(&s, 2);

    assert_eq!(s.contract.try_dispute_escrow(&id, &s.oracle), Err(Ok(EscrowError::Unauthorized)));
    s.contract.set_oracles(&vec![&s.env, b, c], &2);
    assert_eq!(s.contract.try_dispute_escrow(&id, &a), Err(Ok(EscrowError::Unauthorized)));

    let (x, _y, _z) = three_oracles(&s, 2);
    s.contract.dispute_escrow(&id, &x);
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Disputed);
    assert_eq!(balance(&s, &s.seller), 0);
}

// ============================================================================
// Proportional dispute split
// ============================================================================

#[test]
fn test_split_70_30_pays_both_sides_and_empties_the_contract() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);

    s.contract.resolve_dispute_split(&id, &7_000);

    assert_eq!(balance(&s, &s.buyer), BUYER_START - FIFTY_USDC + 350_000_000);
    assert_eq!(balance(&s, &s.seller), 150_000_000);
    assert_eq!(balance(&s, &s.contract.address), 0);
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Delivered);
}

#[test]
fn test_split_full_refund_marks_refunded() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);
    s.contract.resolve_dispute_split(&id, &10_000);
    assert_eq!(balance(&s, &s.buyer), BUYER_START);
    assert_eq!(balance(&s, &s.seller), 0);
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Refunded);
}

#[test]
fn test_split_zero_bps_pays_the_seller_everything() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);
    s.contract.resolve_dispute_split(&id, &0);
    assert_eq!(balance(&s, &s.seller), FIFTY_USDC);
    assert_eq!(s.contract.get_escrow(&id).status, EscrowStatus::Delivered);
}

#[test]
fn test_split_rounding_never_loses_or_creates_funds() {
    let s = setup();
    // 101 base units at 50%: buyer 50 (floor), seller 51 (remainder).
    let id = disputed(&s, 101);
    s.contract.resolve_dispute_split(&id, &5_000);
    assert_eq!(balance(&s, &s.seller), 51);
    assert_eq!(balance(&s, &s.buyer), BUYER_START - 101 + 50);
    assert_eq!(balance(&s, &s.contract.address), 0);

    // 3 base units at 33.33%: buyer rounds down to 0, seller keeps all 3.
    let id2 = disputed(&s, 3);
    let before = balance(&s, &s.buyer);
    s.contract.resolve_dispute_split(&id2, &3_333);
    assert_eq!(balance(&s, &s.buyer), before);
    assert_eq!(balance(&s, &s.contract.address), 0);
}

#[test]
fn test_split_rejects_invalid_bps_and_wrong_status() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);
    assert_eq!(s.contract.try_resolve_dispute_split(&id, &10_001), Err(Ok(EscrowError::InvalidBps)));
    assert_eq!(balance(&s, &s.contract.address), FIFTY_USDC);

    let id2 = shipped(&s, FIFTY_USDC);
    assert_eq!(s.contract.try_resolve_dispute_split(&id2, &5_000), Err(Ok(EscrowError::InvalidStatus)));

    // A resolved dispute cannot be resolved again.
    s.contract.resolve_dispute_split(&id, &5_000);
    assert_eq!(s.contract.try_resolve_dispute_split(&id, &5_000), Err(Ok(EscrowError::InvalidStatus)));
    assert_eq!(s.contract.try_resolve_dispute_split(&999, &5_000), Err(Ok(EscrowError::EscrowNotFound)));
}

#[test]
fn test_resolved_dispute_cannot_be_delivered_or_refunded_again() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);
    s.contract.resolve_dispute_split(&id, &5_000);

    assert_eq!(s.contract.try_confirm_delivery(&id), Err(Ok(EscrowError::InvalidStatus)));
    s.env.ledger().with_mut(|l| l.sequence_number = DEFAULT_TIMEOUT + 1);
    assert_eq!(s.contract.try_claim_refund(&id), Err(Ok(EscrowError::InvalidStatus)));
}

// ============================================================================
// Evidence locker
// ============================================================================

#[test]
fn test_evidence_is_stored_in_order_for_both_parties() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);
    let uri = String::from_str(&s.env, "ipfs://bafyexample");

    s.contract.submit_evidence(&id, &s.buyer, &hash(&s, 1), &uri);
    s.contract.submit_evidence(&id, &s.seller, &hash(&s, 2), &String::from_str(&s.env, ""));

    let items = s.contract.get_evidence(&id);
    assert_eq!(items.len(), 2);
    let first = items.get(0).unwrap();
    assert_eq!(first.submitter, s.buyer);
    assert_eq!(first.hash, hash(&s, 1));
    assert_eq!(first.uri, uri);
    assert_eq!(items.get(1).unwrap().submitter, s.seller);
}

#[test]
fn test_evidence_only_from_the_parties_and_only_while_disputed() {
    let s = setup();
    let id = shipped(&s, FIFTY_USDC);
    let uri = String::from_str(&s.env, "");

    // Not disputed yet.
    assert_eq!(
        s.contract.try_submit_evidence(&id, &s.buyer, &hash(&s, 1), &uri),
        Err(Ok(EscrowError::InvalidStatus))
    );

    s.contract.dispute_escrow(&id, &s.seller);
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.contract.try_submit_evidence(&id, &stranger, &hash(&s, 1), &uri),
        Err(Ok(EscrowError::Unauthorized))
    );
    assert_eq!(
        s.contract.try_submit_evidence(&id, &s.oracle, &hash(&s, 1), &uri),
        Err(Ok(EscrowError::Unauthorized))
    );

    // After resolution no more evidence.
    s.contract.resolve_dispute_split(&id, &5_000);
    assert_eq!(
        s.contract.try_submit_evidence(&id, &s.buyer, &hash(&s, 1), &uri),
        Err(Ok(EscrowError::InvalidStatus))
    );
}

#[test]
fn test_evidence_limit_is_per_party() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);
    let uri = String::from_str(&s.env, "");

    for i in 0..10u8 {
        s.contract.submit_evidence(&id, &s.buyer, &hash(&s, i), &uri);
    }
    assert_eq!(
        s.contract.try_submit_evidence(&id, &s.buyer, &hash(&s, 99), &uri),
        Err(Ok(EscrowError::EvidenceLimit))
    );
    // The seller still has their own quota.
    s.contract.submit_evidence(&id, &s.seller, &hash(&s, 100), &uri);
    assert_eq!(s.contract.get_evidence(&id).len(), 11);
}

#[test]
fn test_evidence_pointer_length_is_capped() {
    let s = setup();
    let id = disputed(&s, FIFTY_USDC);

    let ok = String::from_str(&s.env, &"a".repeat(128));
    s.contract.submit_evidence(&id, &s.buyer, &hash(&s, 1), &ok);

    let too_long = String::from_str(&s.env, &"a".repeat(129));
    assert_eq!(
        s.contract.try_submit_evidence(&id, &s.buyer, &hash(&s, 2), &too_long),
        Err(Ok(EscrowError::EvidenceLimit))
    );
    assert_eq!(s.contract.get_evidence(&id).len(), 1);
}

#[test]
fn test_get_evidence_is_empty_for_unknown_escrow() {
    let s = setup();
    assert_eq!(s.contract.get_evidence(&12345).len(), 0);
    let _ = &s.admin;
}
