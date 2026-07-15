#![cfg(test)]

use crate::{EscrowError, EscrowStatus, TitipEscrowContract, TitipEscrowContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token, Address, Env, String,
};

// ============================================================================
// Test Helpers
// ============================================================================

/// Create a test environment with a USDC token contract and funded accounts.
struct TestSetup<'a> {
    env: Env,
    contract: TitipEscrowContractClient<'a>,
    admin: Address,
    oracle: Address,
    buyer: Address,
    seller: Address,
    token: Address,
    token_admin: Address,
}

fn setup() -> TestSetup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    // Set initial ledger to something reasonable
    env.ledger().set(LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 22,
        sequence_number: 100_000,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    // Deploy the escrow contract
    let contract_id = env.register_contract(None, TitipEscrowContract);
    let contract = TitipEscrowContractClient::new(&env, &contract_id);

    // Create test addresses
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let buyer = Address::generate(&env);
    let seller = Address::generate(&env);

    // Deploy a test USDC token (SAC)
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract_id.address();

    // Mint USDC to buyer (1000 USDC = 10_000_000_000 base units at 7 decimals)
    let token_admin_client = token::StellarAssetClient::new(&env, &token);
    token_admin_client.mint(&buyer, &10_000_000_000_i128);

    TestSetup {
        env,
        contract,
        admin,
        oracle,
        buyer,
        seller,
        token,
        token_admin,
    }
}

/// Helper: 50 USDC in base units (7 decimals)
const FIFTY_USDC: i128 = 500_000_000;

/// Helper: default timeout = current_ledger (100_000) + 51_840 (~72 hours)
const DEFAULT_TIMEOUT: u32 = 100_000 + 51_840;

// ============================================================================
// initialize tests
// ============================================================================

#[test]
fn test_initialize_success() {
    let s = setup();

    let result = s.contract.try_initialize(&s.admin, &s.oracle, &s.token);
    assert!(result.is_ok());

    // Verify config is stored correctly
    let config = s.contract.get_config();
    assert_eq!(config.admin, s.admin);
    assert_eq!(config.oracle, s.oracle);
    assert_eq!(config.token, s.token);
    assert_eq!(config.next_escrow_id, 1);
}

#[test]
fn test_initialize_cannot_be_called_twice() {
    let s = setup();

    s.contract.initialize(&s.admin, &s.oracle, &s.token);
    let result = s.contract.try_initialize(&s.admin, &s.oracle, &s.token);

    assert_eq!(result, Err(Ok(EscrowError::AlreadyInitialized)));
}

// ============================================================================
// create_escrow tests
// ============================================================================

#[test]
fn test_create_escrow_success() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(
        &s.buyer,
        &s.seller,
        &FIFTY_USDC,
        &DEFAULT_TIMEOUT,
    );
    assert_eq!(escrow_id, 1);

    let escrow = s.contract.get_escrow(&1);
    assert_eq!(escrow.escrow_id, 1);
    assert_eq!(escrow.buyer, s.buyer);
    assert_eq!(escrow.seller, s.seller);
    assert_eq!(escrow.amount, FIFTY_USDC);
    assert_eq!(escrow.status, EscrowStatus::Pending);
    assert_eq!(escrow.timeout_ledger, DEFAULT_TIMEOUT);
}

#[test]
fn test_create_escrow_increments_id() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let id1 = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    let id2 = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    let id3 = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
}

#[test]
fn test_create_escrow_zero_amount_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let result = s.contract.try_create_escrow(&s.buyer, &s.seller, &0_i128, &DEFAULT_TIMEOUT);
    assert_eq!(result, Err(Ok(EscrowError::InvalidAmount)));
}

#[test]
fn test_create_escrow_negative_amount_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let result = s.contract.try_create_escrow(&s.buyer, &s.seller, &-100_i128, &DEFAULT_TIMEOUT);
    assert_eq!(result, Err(Ok(EscrowError::InvalidAmount)));
}

#[test]
fn test_create_escrow_timeout_too_short_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    // current_ledger = 100_000, minimum = 100_000 + 1000 = 101_000
    let short_timeout: u32 = 100_999;
    let result = s.contract.try_create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &short_timeout);
    assert_eq!(result, Err(Ok(EscrowError::InvalidTimeout)));
}

#[test]
fn test_create_escrow_buyer_is_seller_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let result = s.contract.try_create_escrow(&s.buyer, &s.buyer, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    assert_eq!(result, Err(Ok(EscrowError::BuyerIsSeller)));
}

#[test]
fn test_create_escrow_not_initialized_fails() {
    let s = setup();

    let result = s.contract.try_create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    assert_eq!(result, Err(Ok(EscrowError::NotInitialized)));
}

// ============================================================================
// fund tests
// ============================================================================

#[test]
fn test_fund_success() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let escrow = s.contract.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Funded);

    // Verify token transfer: buyer balance decreased, contract holds USDC
    let token_client = token::Client::new(&s.env, &s.token);
    let buyer_balance = token_client.balance(&s.buyer);
    assert_eq!(buyer_balance, 10_000_000_000_i128 - FIFTY_USDC);

    let contract_balance = token_client.balance(&s.contract.address);
    assert_eq!(contract_balance, FIFTY_USDC);
}

#[test]
fn test_fund_already_funded_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let result = s.contract.try_fund(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_fund_nonexistent_escrow_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let result = s.contract.try_fund(&999_u64);
    assert_eq!(result, Err(Ok(EscrowError::EscrowNotFound)));
}

// ============================================================================
// submit_tracking tests
// ============================================================================

#[test]
fn test_submit_tracking_success() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);

    let escrow = s.contract.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Shipped);
    assert_eq!(escrow.tracking_number, tracking);
    assert_eq!(escrow.courier_code, courier);
}

#[test]
fn test_submit_tracking_pending_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    let result = s.contract.try_submit_tracking(&escrow_id, &tracking, &courier);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_submit_tracking_already_shipped_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);

    // Submit again should fail
    let tracking2 = String::from_str(&s.env, "JT9999999999");
    let courier2 = String::from_str(&s.env, "jne");
    let result = s.contract.try_submit_tracking(&escrow_id, &tracking2, &courier2);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

// ============================================================================
// confirm_delivery tests
// ============================================================================

#[test]
fn test_confirm_delivery_success() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);

    s.contract.confirm_delivery(&escrow_id);

    let escrow = s.contract.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Delivered);

    // Verify USDC went to seller
    let token_client = token::Client::new(&s.env, &s.token);
    let seller_balance = token_client.balance(&s.seller);
    assert_eq!(seller_balance, FIFTY_USDC);

    // Contract should have zero balance
    let contract_balance = token_client.balance(&s.contract.address);
    assert_eq!(contract_balance, 0);
}

#[test]
fn test_confirm_delivery_not_shipped_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    // Try to confirm without shipping
    let result = s.contract.try_confirm_delivery(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_confirm_delivery_already_delivered_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);
    s.contract.confirm_delivery(&escrow_id);

    // Try again
    let result = s.contract.try_confirm_delivery(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

// ============================================================================
// claim_refund tests
// ============================================================================

#[test]
fn test_claim_refund_after_timeout_funded() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    // Advance ledger past timeout
    s.env.ledger().set(LedgerInfo {
        timestamp: 1_700_500_000,
        protocol_version: 22,
        sequence_number: DEFAULT_TIMEOUT + 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    s.contract.claim_refund(&escrow_id);

    let escrow = s.contract.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);

    // Verify buyer got USDC back
    let token_client = token::Client::new(&s.env, &s.token);
    let buyer_balance = token_client.balance(&s.buyer);
    assert_eq!(buyer_balance, 10_000_000_000_i128);

    // Contract should be empty
    let contract_balance = token_client.balance(&s.contract.address);
    assert_eq!(contract_balance, 0);
}

#[test]
fn test_claim_refund_after_timeout_shipped() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);

    // Advance ledger past timeout
    s.env.ledger().set(LedgerInfo {
        timestamp: 1_700_500_000,
        protocol_version: 22,
        sequence_number: DEFAULT_TIMEOUT + 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    // Buyer can still refund even if shipped, as long as timeout passed
    s.contract.claim_refund(&escrow_id);

    let escrow = s.contract.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
}

#[test]
fn test_claim_refund_before_timeout_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    // Ledger is still at 100_000, timeout is 151_840
    let result = s.contract.try_claim_refund(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::TimeoutNotReached)));
}

#[test]
fn test_claim_refund_on_pending_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);

    // Advance past timeout
    s.env.ledger().set(LedgerInfo {
        timestamp: 1_700_500_000,
        protocol_version: 22,
        sequence_number: DEFAULT_TIMEOUT + 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    // Can't refund PENDING — no funds are locked
    let result = s.contract.try_claim_refund(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_claim_refund_on_delivered_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);
    s.contract.confirm_delivery(&escrow_id);

    // Advance past timeout
    s.env.ledger().set(LedgerInfo {
        timestamp: 1_700_500_000,
        protocol_version: 22,
        sequence_number: DEFAULT_TIMEOUT + 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    // Business rule #3: DELIVERED escrow can never be refunded
    let result = s.contract.try_claim_refund(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_claim_refund_already_refunded_fails() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    // Advance past timeout
    s.env.ledger().set(LedgerInfo {
        timestamp: 1_700_500_000,
        protocol_version: 22,
        sequence_number: DEFAULT_TIMEOUT + 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    s.contract.claim_refund(&escrow_id);

    // Business rule #4: REFUNDED escrow can never be released or refunded again
    let result = s.contract.try_claim_refund(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

// ============================================================================
// Terminal state enforcement (business rules #3 and #4)
// ============================================================================

#[test]
fn test_delivered_cannot_transition() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);
    s.contract.confirm_delivery(&escrow_id);

    // Cannot fund again
    let result = s.contract.try_fund(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));

    // Cannot submit tracking again
    let t2 = String::from_str(&s.env, "XX000");
    let c2 = String::from_str(&s.env, "jne");
    let result = s.contract.try_submit_tracking(&escrow_id, &t2, &c2);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));

    // Cannot confirm delivery again
    let result = s.contract.try_confirm_delivery(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

#[test]
fn test_refunded_cannot_be_delivered() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);

    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);

    // Advance past timeout and refund
    s.env.ledger().set(LedgerInfo {
        timestamp: 1_700_500_000,
        protocol_version: 22,
        sequence_number: DEFAULT_TIMEOUT + 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    s.contract.claim_refund(&escrow_id);

    // Business rule #4: REFUNDED cannot be delivered
    let result = s.contract.try_confirm_delivery(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::InvalidStatus)));
}

// ============================================================================
// Full happy path integration test
// ============================================================================

#[test]
fn test_full_happy_path() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let token_client = token::Client::new(&s.env, &s.token);

    // 1. Create escrow
    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    assert_eq!(escrow_id, 1);
    assert_eq!(s.contract.get_escrow(&1).status, EscrowStatus::Pending);

    // 2. Fund escrow
    s.contract.fund(&escrow_id);
    assert_eq!(s.contract.get_escrow(&1).status, EscrowStatus::Funded);
    assert_eq!(token_client.balance(&s.contract.address), FIFTY_USDC);

    // 3. Submit tracking
    let tracking = String::from_str(&s.env, "JT1234567890");
    let courier = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&escrow_id, &tracking, &courier);
    assert_eq!(s.contract.get_escrow(&1).status, EscrowStatus::Shipped);

    // 4. Oracle confirms delivery
    s.contract.confirm_delivery(&escrow_id);
    assert_eq!(s.contract.get_escrow(&1).status, EscrowStatus::Delivered);

    // 5. Verify final balances
    let buyer_final = token_client.balance(&s.buyer);
    let seller_final = token_client.balance(&s.seller);
    let contract_final = token_client.balance(&s.contract.address);

    assert_eq!(buyer_final, 10_000_000_000_i128 - FIFTY_USDC); // Buyer spent 50 USDC
    assert_eq!(seller_final, FIFTY_USDC);                       // Seller received 50 USDC
    assert_eq!(contract_final, 0);                               // Contract is empty
}

// ============================================================================
// Full timeout/refund path integration test
// ============================================================================

#[test]
fn test_full_refund_path() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let token_client = token::Client::new(&s.env, &s.token);
    let initial_buyer_balance = token_client.balance(&s.buyer);

    // 1. Create and fund
    let escrow_id = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);
    s.contract.fund(&escrow_id);
    assert_eq!(token_client.balance(&s.buyer), initial_buyer_balance - FIFTY_USDC);

    // 2. Time passes... buyer waits, no delivery
    s.env.ledger().set(LedgerInfo {
        timestamp: 1_700_500_000,
        protocol_version: 22,
        sequence_number: DEFAULT_TIMEOUT + 1,
        network_id: [0u8; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 1_000_000,
    });

    // 3. Buyer claims refund
    s.contract.claim_refund(&escrow_id);
    assert_eq!(s.contract.get_escrow(&escrow_id).status, EscrowStatus::Refunded);

    // 4. Verify buyer got full refund
    assert_eq!(token_client.balance(&s.buyer), initial_buyer_balance);
    assert_eq!(token_client.balance(&s.seller), 0);
    assert_eq!(token_client.balance(&s.contract.address), 0);
}

// ============================================================================
// Admin functions tests
// ============================================================================

#[test]
fn test_update_oracle() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let new_oracle = Address::generate(&s.env);
    s.contract.update_oracle(&new_oracle);

    let config = s.contract.get_config();
    assert_eq!(config.oracle, new_oracle);
}

// ============================================================================
// Multiple escrows test
// ============================================================================

#[test]
fn test_multiple_concurrent_escrows() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let token_client = token::Client::new(&s.env, &s.token);
    let amount_25 = 250_000_000_i128; // 25 USDC

    // Create two escrows with different amounts
    let id1 = s.contract.create_escrow(&s.buyer, &s.seller, &amount_25, &DEFAULT_TIMEOUT);
    let id2 = s.contract.create_escrow(&s.buyer, &s.seller, &FIFTY_USDC, &DEFAULT_TIMEOUT);

    // Fund both
    s.contract.fund(&id1);
    s.contract.fund(&id2);

    // Contract should hold 75 USDC
    assert_eq!(
        token_client.balance(&s.contract.address),
        amount_25 + FIFTY_USDC
    );

    // Ship and deliver first escrow
    let t1 = String::from_str(&s.env, "JT0001");
    let c1 = String::from_str(&s.env, "jnt");
    s.contract.submit_tracking(&id1, &t1, &c1);
    s.contract.confirm_delivery(&id1);

    assert_eq!(s.contract.get_escrow(&id1).status, EscrowStatus::Delivered);
    assert_eq!(s.contract.get_escrow(&id2).status, EscrowStatus::Funded);

    // Contract should now hold only 50 USDC (second escrow)
    assert_eq!(token_client.balance(&s.contract.address), FIFTY_USDC);

    // Seller got 25 USDC from first escrow
    assert_eq!(token_client.balance(&s.seller), amount_25);
}

// ============================================================================
// get_escrow not found
// ============================================================================

#[test]
fn test_get_escrow_not_found() {
    let s = setup();
    s.contract.initialize(&s.admin, &s.oracle, &s.token);

    let result = s.contract.try_get_escrow(&999_u64);
    assert_eq!(result, Err(Ok(EscrowError::EscrowNotFound)));
}

// ============================================================================
// get_config not initialized
// ============================================================================

#[test]
fn test_get_config_not_initialized() {
    let s = setup();

    let result = s.contract.try_get_config();
    assert_eq!(result, Err(Ok(EscrowError::NotInitialized)));
}
