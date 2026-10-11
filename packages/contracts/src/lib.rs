#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, log, symbol_short, token, Address, BytesN, Env,
    String, Vec,
};

// ============================================================================
// Data Types
// ============================================================================

/// Escrow lifecycle states — terminal states are DELIVERED and REFUNDED.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    /// Created but not yet funded by buyer
    Pending,
    /// Buyer has deposited USDC into the contract
    Funded,
    /// Seller has submitted a tracking number
    Shipped,
    /// Oracle confirmed delivery — USDC released to seller (terminal)
    Delivered,
    /// Buyer claimed refund after timeout (terminal)
    Refunded,
    /// Transaction is disputed (v1.1 grace period / admin arbitration)
    Disputed,
}

/// Core escrow record stored on-chain.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Escrow {
    pub escrow_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub amount: i128,
    pub status: EscrowStatus,
    pub token: Address,
    /// Ledger sequence number after which the buyer can claim a refund.
    pub timeout_ledger: u32,
    /// Tracking number submitted by the seller.
    pub tracking_number: String,
    /// Courier code (e.g., "jnt", "jne", "sicepat").
    pub courier_code: String,
}

/// Global contract configuration.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub oracle: Address,
    pub token: Address,
    pub next_escrow_id: u64,
}

/// M-of-N oracle set. When present it replaces the single `Config.oracle`: delivery is released
/// only once `threshold` distinct oracles from `oracles` have approved it.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OracleSet {
    pub oracles: Vec<Address>,
    pub threshold: u32,
}

/// One piece of dispute evidence: a SHA-256 hash of the file plus an optional pointer (e.g. an
/// IPFS CID or a URL). The file itself is never stored on-chain.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EvidenceItem {
    pub submitter: Address,
    pub hash: BytesN<32>,
    pub uri: String,
    pub ledger: u32,
}

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DataKey {
    Config,
    Escrow(u64),
    /// Optional M-of-N oracle set (absent = legacy single oracle).
    OracleSet,
    /// Oracles that approved delivery of an escrow.
    Approvals(u64),
    /// Evidence committed for a disputed escrow.
    Evidence(u64),
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    /// Contract has already been initialized.
    AlreadyInitialized = 1,
    /// Contract has not been initialized yet.
    NotInitialized = 2,
    /// Caller is not authorized for this operation.
    Unauthorized = 3,
    /// The escrow is not in the expected status for this operation.
    InvalidStatus = 4,
    /// The amount must be greater than zero.
    InvalidAmount = 5,
    /// Timeout must be at least 1000 ledgers in the future.
    InvalidTimeout = 6,
    /// The specified escrow ID does not exist.
    EscrowNotFound = 7,
    /// Timeout has not yet been reached; cannot refund.
    TimeoutNotReached = 8,
    /// Buyer cannot be the same address as seller.
    BuyerIsSeller = 9,
    /// Oracle set is empty, too large, has duplicates, or the threshold is out of range.
    InvalidOracleSet = 10,
    /// Basis points must be between 0 and 10_000.
    InvalidBps = 11,
    /// Evidence limit reached or the evidence pointer is too long.
    EvidenceLimit = 12,
}

// ============================================================================
// Constants
// ============================================================================

/// Minimum timeout: 1000 ledgers (~83 minutes at ~5s/ledger).
const MIN_TIMEOUT_LEDGERS: u32 = 1000;

/// Maximum number of oracles in an M-of-N set.
const MAX_ORACLES: u32 = 10;

/// Maximum evidence items per party per escrow, and maximum length of an evidence pointer.
const MAX_EVIDENCE_PER_PARTY: u32 = 10;
const MAX_EVIDENCE_URI_LEN: u32 = 128;

/// Basis points denominator (100% = 10_000).
const BPS_DENOMINATOR: i128 = 10_000;

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct TitipEscrowContract;

#[contractimpl]
impl TitipEscrowContract {
    // ------------------------------------------------------------------------
    // initialize
    // ------------------------------------------------------------------------

    /// Initialize the contract with admin, oracle, and USDC token addresses.
    ///
    /// Must be called exactly once before any other function.
    ///
    /// # Arguments
    /// * `admin`  — Administrator address (can update oracle, pause contract in v1.1).
    /// * `oracle` — Courier oracle address (only address allowed to call `confirm_delivery`).
    /// * `token`  — SAC token contract address for USDC.
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        token: Address,
    ) -> Result<(), EscrowError> {
        // Prevent double initialization
        if env.storage().instance().has(&DataKey::Config) {
            return Err(EscrowError::AlreadyInitialized);
        }

        let config = Config {
            admin: admin.clone(),
            oracle: oracle.clone(),
            token: token.clone(),
            next_escrow_id: 1,
        };

        env.storage().instance().set(&DataKey::Config, &config);

        // Extend TTL to 30 days (~518400 ledgers at 5s/ledger)
        // TODO(mainnet): Tune TTL values based on actual ledger close times
        env.storage().instance().extend_ttl(518_400, 518_400);

        log!(&env, "Titip Escrow initialized: admin={}, oracle={}", admin, oracle);

        Ok(())
    }

    // ------------------------------------------------------------------------
    // create_escrow
    // ------------------------------------------------------------------------

    /// Create a new escrow between buyer and seller.
    ///
    /// Does NOT transfer funds — the buyer must call `fund()` separately.
    /// This two-step flow allows the frontend to show a preview before locking funds.
    ///
    /// # Arguments
    /// * `buyer`           — Buyer's Stellar address.
    /// * `seller`          — Seller's Stellar address (derived from QRIS merchant ID).
    /// * `amount`          — USDC amount in base units (7 decimals). 50 USDC = 500_000_000.
    /// * `timeout_ledger`  — Ledger number after which the buyer can claim a refund.
    ///                       Must be at least current_ledger + MIN_TIMEOUT_LEDGERS.
    ///
    /// # Returns
    /// The new escrow ID.
    pub fn create_escrow(
        env: Env,
        buyer: Address,
        seller: Address,
        amount: i128,
        timeout_ledger: u32,
    ) -> Result<u64, EscrowError> {
        buyer.require_auth();

        // Validate inputs
        if buyer == seller {
            return Err(EscrowError::BuyerIsSeller);
        }

        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        let current_ledger = env.ledger().sequence();
        if timeout_ledger < current_ledger + MIN_TIMEOUT_LEDGERS {
            return Err(EscrowError::InvalidTimeout);
        }

        // Load config
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;

        let escrow_id = config.next_escrow_id;
        config.next_escrow_id += 1;

        let escrow = Escrow {
            escrow_id,
            buyer: buyer.clone(),
            seller: seller.clone(),
            amount,
            status: EscrowStatus::Pending,
            token: config.token.clone(),
            timeout_ledger,
            tracking_number: String::from_str(&env, ""),
            courier_code: String::from_str(&env, ""),
        };

        // Persist
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        // Extend TTL for the escrow — at least until timeout + buffer
        // v1.1: Calculate exact TTL based on timeout_ledger - current_ledger + buffer
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(escrow_id), 518_400, 518_400);

        log!(&env, "Escrow {} created: buyer={}, seller={}, amount={}", escrow_id, buyer, seller, amount);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("created")),
            (escrow_id, buyer, seller, amount),
        );

        Ok(escrow_id)
    }

    // ------------------------------------------------------------------------
    // fund
    // ------------------------------------------------------------------------

    /// Fund an escrow by transferring USDC from the buyer to this contract.
    ///
    /// Transitions: PENDING → FUNDED.
    ///
    /// The buyer must have approved or have sufficient balance for the SAC token transfer.
    ///
    /// # Arguments
    /// * `escrow_id` — The escrow to fund.
    pub fn fund(env: Env, escrow_id: u64) -> Result<(), EscrowError> {
        let mut escrow = Self::load_escrow(&env, escrow_id)?;

        // Only the buyer can fund
        escrow.buyer.require_auth();

        // Must be in PENDING status
        if escrow.status != EscrowStatus::Pending {
            return Err(EscrowError::InvalidStatus);
        }

        // Transfer USDC from buyer to this contract
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &escrow.buyer,
            &env.current_contract_address(),
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Funded;
        Self::save_escrow(&env, &escrow);

        log!(&env, "Escrow {} funded: {} base units", escrow_id, escrow.amount);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("funded")),
            (escrow_id, escrow.buyer.clone(), escrow.amount),
        );

        Ok(())
    }

    // ------------------------------------------------------------------------
    // submit_tracking
    // ------------------------------------------------------------------------

    /// Seller submits a tracking number and courier code.
    ///
    /// Transitions: FUNDED → SHIPPED.
    ///
    /// # Arguments
    /// * `escrow_id`       — The escrow to update.
    /// * `tracking_number` — Courier tracking number.
    /// * `courier_code`    — Courier identifier (e.g., "jnt", "jne", "sicepat").
    pub fn submit_tracking(
        env: Env,
        escrow_id: u64,
        tracking_number: String,
        courier_code: String,
    ) -> Result<(), EscrowError> {
        let mut escrow = Self::load_escrow(&env, escrow_id)?;

        // Only the seller can submit tracking
        escrow.seller.require_auth();

        // Must be FUNDED
        if escrow.status != EscrowStatus::Funded {
            return Err(EscrowError::InvalidStatus);
        }

        escrow.tracking_number = tracking_number;
        escrow.courier_code = courier_code;
        escrow.status = EscrowStatus::Shipped;
        Self::save_escrow(&env, &escrow);

        log!(&env, "Escrow {} shipped", escrow_id);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("shipped")),
            (escrow_id, escrow.seller.clone()),
        );

        Ok(())
    }

    // ------------------------------------------------------------------------
    // confirm_delivery
    // ------------------------------------------------------------------------

    /// Oracle confirms delivery — releases USDC to the seller.
    ///
    /// Transitions: SHIPPED → DELIVERED (terminal).
    ///
    /// Only the oracle address stored in Config can call this function.
    /// The contract will reject any other invoker.
    ///
    /// # Arguments
    /// * `escrow_id` — The escrow to confirm.
    pub fn confirm_delivery(env: Env, escrow_id: u64) -> Result<(), EscrowError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;

        // Once an M-of-N oracle set is configured, a single oracle must never be able to release
        // funds alone: delivery then goes through `approve_delivery` only.
        if env.storage().instance().has(&DataKey::OracleSet) {
            return Err(EscrowError::Unauthorized);
        }

        // Only the oracle can confirm delivery
        config.oracle.require_auth();

        let mut escrow = Self::load_escrow(&env, escrow_id)?;

        // Must be SHIPPED
        if escrow.status != EscrowStatus::Shipped {
            return Err(EscrowError::InvalidStatus);
        }

        Self::release_to_seller(&env, &mut escrow);

        Ok(())
    }

    // ------------------------------------------------------------------------
    // approve_delivery (M-of-N oracle)
    // ------------------------------------------------------------------------

    /// One oracle of the configured set approves delivery. When `threshold` distinct, currently
    /// listed oracles have approved, the funds are released to the seller.
    ///
    /// Returns `true` if this call released the funds. Calling again with an oracle that has
    /// already approved is allowed and only re-evaluates (it never counts twice), which also
    /// completes a delivery whose threshold was lowered after the approvals were collected.
    ///
    /// Transitions: SHIPPED -> DELIVERED (terminal) once the threshold is met.
    pub fn approve_delivery(env: Env, escrow_id: u64, oracle: Address) -> Result<bool, EscrowError> {
        let config = Self::get_config(env.clone())?;
        oracle.require_auth();

        let set = Self::effective_oracle_set(&env, &config);
        if !set.oracles.contains(&oracle) {
            return Err(EscrowError::Unauthorized);
        }

        let mut escrow = Self::load_escrow(&env, escrow_id)?;
        if escrow.status != EscrowStatus::Shipped {
            return Err(EscrowError::InvalidStatus);
        }

        let key = DataKey::Approvals(escrow_id);
        let mut approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        if !approvals.contains(&oracle) {
            approvals.push_back(oracle.clone());
            env.storage().persistent().set(&key, &approvals);
            env.storage().persistent().extend_ttl(&key, 518_400, 518_400);
            env.events().publish(
                (symbol_short!("escrow"), symbol_short!("approve")),
                (escrow_id, oracle.clone()),
            );
        }

        // Only approvals from oracles that are still in the set count.
        let mut valid: u32 = 0;
        for approver in approvals.iter() {
            if set.oracles.contains(&approver) {
                valid += 1;
            }
        }
        if valid < set.threshold {
            return Ok(false);
        }

        env.storage().persistent().remove(&key);
        Self::release_to_seller(&env, &mut escrow);
        Ok(true)
    }

    /// Replace the oracle set. Admin only. `threshold` of the `oracles` must approve a delivery.
    /// Approvals already collected stay stored, but only those from oracles that remain in the
    /// set are counted.
    pub fn set_oracles(env: Env, oracles: Vec<Address>, threshold: u32) -> Result<(), EscrowError> {
        let config = Self::get_config(env.clone())?;
        config.admin.require_auth();

        let n = oracles.len();
        if n == 0 || n > MAX_ORACLES || threshold == 0 || threshold > n {
            return Err(EscrowError::InvalidOracleSet);
        }
        for i in 0..n {
            let a = oracles.get(i).unwrap();
            for j in (i + 1)..n {
                if oracles.get(j).unwrap() == a {
                    return Err(EscrowError::InvalidOracleSet);
                }
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::OracleSet, &OracleSet { oracles, threshold });
        env.storage().instance().extend_ttl(518_400, 518_400);

        log!(&env, "Oracle set updated: {} oracles, threshold {}", n, threshold);
        Ok(())
    }

    /// The configured M-of-N oracle set, or `None` while the contract still uses the single oracle.
    pub fn get_oracle_set(env: Env) -> Option<OracleSet> {
        env.storage().instance().get(&DataKey::OracleSet)
    }

    /// Oracles that have approved delivery of this escrow so far.
    pub fn get_delivery_approvals(env: Env, escrow_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Approvals(escrow_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ------------------------------------------------------------------------
    // Dispute & Resolution (v1.1)
    // ------------------------------------------------------------------------

    /// Dispute an escrow transaction. Can be called by the buyer, the seller, or the
    /// whitelisted oracle (which freezes the escrow when the courier reports a return to
    /// sender). The oracle can only move funds INTO dispute; it still cannot release them:
    /// only `resolve_dispute` (admin) pays out a disputed escrow.
    ///
    /// Transitions: FUNDED | SHIPPED -> DISPUTED.
    pub fn dispute_escrow(env: Env, escrow_id: u64, caller: Address) -> Result<(), EscrowError> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;
        let mut escrow = Self::load_escrow(&env, escrow_id)?;

        caller.require_auth();

        let is_oracle = Self::effective_oracle_set(&env, &config).oracles.contains(&caller);
        if caller != escrow.buyer && caller != escrow.seller && !is_oracle {
            return Err(EscrowError::Unauthorized);
        }

        if escrow.status != EscrowStatus::Funded && escrow.status != EscrowStatus::Shipped {
            return Err(EscrowError::InvalidStatus);
        }

        escrow.status = EscrowStatus::Disputed;
        Self::save_escrow(&env, &escrow);

        log!(&env, "Escrow {} disputed by {}", escrow_id, caller);
        env.events().publish((symbol_short!("escrow"), symbol_short!("disputed")), (escrow_id, caller));

        Ok(())
    }

    /// Admin resolves a dispute by sending funds to the winner.
    ///
    /// Transitions: DISPUTED -> DELIVERED (if seller wins) or REFUNDED (if buyer wins).
    pub fn resolve_dispute(env: Env, escrow_id: u64, winner: Address) -> Result<(), EscrowError> {
        let mut escrow = Self::load_escrow(&env, escrow_id)?;
        let config = Self::get_config(env.clone())?;

        config.admin.require_auth();

        if escrow.status != EscrowStatus::Disputed {
            return Err(EscrowError::InvalidStatus);
        }

        if winner != escrow.buyer && winner != escrow.seller {
            return Err(EscrowError::Unauthorized); // Winner must be buyer or seller
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &winner,
            &escrow.amount,
        );

        if winner == escrow.buyer {
            escrow.status = EscrowStatus::Refunded;
        } else {
            escrow.status = EscrowStatus::Delivered;
        }

        Self::save_escrow(&env, &escrow);

        log!(&env, "Escrow {} dispute resolved, winner: {}", escrow_id, winner);
        env.events().publish((symbol_short!("escrow"), symbol_short!("resolved")), (escrow_id, winner.clone(), escrow.amount));

        Ok(())
    }

    /// Admin resolves a dispute with a proportional split, e.g. `buyer_bps = 7000` refunds 70% to
    /// the buyer and pays 30% to the seller.
    ///
    /// The buyer's share is rounded down and the seller receives the remainder, so the two
    /// payouts always add up to exactly the locked amount. Transitions: DISPUTED -> REFUNDED when
    /// the buyer gets everything (`buyer_bps = 10_000`), otherwise DISPUTED -> DELIVERED.
    pub fn resolve_dispute_split(env: Env, escrow_id: u64, buyer_bps: u32) -> Result<(), EscrowError> {
        let mut escrow = Self::load_escrow(&env, escrow_id)?;
        let config = Self::get_config(env.clone())?;

        config.admin.require_auth();

        if escrow.status != EscrowStatus::Disputed {
            return Err(EscrowError::InvalidStatus);
        }
        if (buyer_bps as i128) > BPS_DENOMINATOR {
            return Err(EscrowError::InvalidBps);
        }

        let buyer_amount = escrow
            .amount
            .checked_mul(buyer_bps as i128)
            .ok_or(EscrowError::InvalidAmount)?
            / BPS_DENOMINATOR;
        let seller_amount = escrow.amount - buyer_amount;

        let token_client = token::Client::new(&env, &escrow.token);
        if buyer_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &escrow.buyer, &buyer_amount);
        }
        if seller_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &escrow.seller, &seller_amount);
        }

        escrow.status = if seller_amount == 0 { EscrowStatus::Refunded } else { EscrowStatus::Delivered };
        Self::save_escrow(&env, &escrow);

        log!(&env, "Escrow {} dispute split: buyer {} / seller {}", escrow_id, buyer_amount, seller_amount);
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("split")),
            (escrow_id, buyer_amount, seller_amount),
        );

        Ok(())
    }

    /// Buyer or seller commits the SHA-256 hash of a piece of evidence (photo, unboxing video) for
    /// a disputed escrow. The file stays off-chain; `uri` is an optional pointer (e.g. a CID).
    /// Each party may submit at most 10 items. Evidence can only be added while Disputed.
    pub fn submit_evidence(
        env: Env,
        escrow_id: u64,
        party: Address,
        hash: BytesN<32>,
        uri: String,
    ) -> Result<(), EscrowError> {
        party.require_auth();

        let escrow = Self::load_escrow(&env, escrow_id)?;
        if party != escrow.buyer && party != escrow.seller {
            return Err(EscrowError::Unauthorized);
        }
        if escrow.status != EscrowStatus::Disputed {
            return Err(EscrowError::InvalidStatus);
        }
        if uri.len() > MAX_EVIDENCE_URI_LEN {
            return Err(EscrowError::EvidenceLimit);
        }

        let key = DataKey::Evidence(escrow_id);
        let mut items: Vec<EvidenceItem> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut by_party: u32 = 0;
        for item in items.iter() {
            if item.submitter == party {
                by_party += 1;
            }
        }
        if by_party >= MAX_EVIDENCE_PER_PARTY {
            return Err(EscrowError::EvidenceLimit);
        }

        items.push_back(EvidenceItem {
            submitter: party.clone(),
            hash: hash.clone(),
            uri,
            ledger: env.ledger().sequence(),
        });
        env.storage().persistent().set(&key, &items);
        env.storage().persistent().extend_ttl(&key, 518_400, 518_400);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("evidence")),
            (escrow_id, party, hash),
        );

        Ok(())
    }

    /// All evidence committed for an escrow, oldest first.
    pub fn get_evidence(env: Env, escrow_id: u64) -> Vec<EvidenceItem> {
        env.storage()
            .persistent()
            .get(&DataKey::Evidence(escrow_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    // ------------------------------------------------------------------------

    /// Buyer claims a refund after the timeout has passed.
    ///
    /// Transitions: FUNDED | SHIPPED → REFUNDED (terminal).
    ///
    /// The refund is only available after `timeout_ledger` has been reached.
    /// A DELIVERED escrow can never be refunded (business rule #3).
    ///
    /// # Arguments
    /// * `escrow_id` — The escrow to refund.
    pub fn claim_refund(env: Env, escrow_id: u64) -> Result<(), EscrowError> {
        let mut escrow = Self::load_escrow(&env, escrow_id)?;

        // Only the buyer can claim refund
        escrow.buyer.require_auth();

        // Must be FUNDED or SHIPPED (not PENDING, DELIVERED, or REFUNDED)
        if escrow.status != EscrowStatus::Funded && escrow.status != EscrowStatus::Shipped {
            return Err(EscrowError::InvalidStatus);
        }

        // Check timeout
        let current_ledger = env.ledger().sequence();
        if current_ledger < escrow.timeout_ledger {
            return Err(EscrowError::TimeoutNotReached);
        }

        // Transfer USDC back to buyer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.buyer,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Refunded;
        Self::save_escrow(&env, &escrow);

        log!(&env, "Escrow {} refunded to buyer", escrow_id);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refund")),
            (escrow_id, escrow.buyer.clone(), escrow.amount),
        );

        Ok(())
    }

    // ------------------------------------------------------------------------
    // Read-only queries
    // ------------------------------------------------------------------------

    /// Get an escrow by ID. Returns None if not found.
    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<Escrow, EscrowError> {
        Self::load_escrow(&env, escrow_id)
    }

    /// Get the current contract configuration.
    pub fn get_config(env: Env) -> Result<Config, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)
    }

    // ------------------------------------------------------------------------
    // Admin functions
    // ------------------------------------------------------------------------

    /// Update the oracle address. Only the admin can call this.
    ///
    /// # Arguments
    /// * `new_oracle` — New oracle address to authorize for `confirm_delivery`.
    pub fn update_oracle(env: Env, new_oracle: Address) -> Result<(), EscrowError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)?;

        config.admin.require_auth();

        config.oracle = new_oracle.clone();
        env.storage().instance().set(&DataKey::Config, &config);
        // Returning to a single oracle: drop any M-of-N set so it cannot keep the old oracles.
        env.storage().instance().remove(&DataKey::OracleSet);

        log!(&env, "Oracle updated to {}", new_oracle);

        Ok(())
    }

    // ------------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------------

    /// The oracle set in force: the configured M-of-N set, or the legacy single oracle (1-of-1).
    fn effective_oracle_set(env: &Env, config: &Config) -> OracleSet {
        env.storage()
            .instance()
            .get(&DataKey::OracleSet)
            .unwrap_or_else(|| {
                let mut oracles = Vec::new(env);
                oracles.push_back(config.oracle.clone());
                OracleSet { oracles, threshold: 1 }
            })
    }

    /// Pay the full escrow amount to the seller and mark the escrow Delivered (terminal).
    /// Caller must already have checked authorization and that the status is Shipped.
    fn release_to_seller(env: &Env, escrow: &mut Escrow) {
        let token_client = token::Client::new(env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.seller, &escrow.amount);

        escrow.status = EscrowStatus::Delivered;
        Self::save_escrow(env, escrow);

        log!(env, "Escrow {} delivered: USDC released to seller", escrow.escrow_id);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deliver")),
            (escrow.escrow_id, escrow.seller.clone(), escrow.amount),
        );
    }

    fn load_escrow(env: &Env, escrow_id: u64) -> Result<Escrow, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(EscrowError::EscrowNotFound)
    }

    fn save_escrow(env: &Env, escrow: &Escrow) {
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow.escrow_id), escrow);

        // Extend TTL on every write
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(escrow.escrow_id), 518_400, 518_400);
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod test_multisig;
