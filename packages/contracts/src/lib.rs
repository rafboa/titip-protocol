#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, log, symbol_short, token, Address, Env, String
    
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

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DataKey {
    Config,
    Escrow(u64),
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
}

// ============================================================================
// Constants
// ============================================================================

/// Minimum timeout: 1000 ledgers (~83 minutes at ~5s/ledger).
const MIN_TIMEOUT_LEDGERS: u32 = 1000;

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

        // Only the oracle can confirm delivery
        config.oracle.require_auth();

        let mut escrow = Self::load_escrow(&env, escrow_id)?;

        // Must be SHIPPED
        if escrow.status != EscrowStatus::Shipped {
            return Err(EscrowError::InvalidStatus);
        }

        // Transfer USDC from contract to seller
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.seller,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Delivered;
        Self::save_escrow(&env, &escrow);

        log!(&env, "Escrow {} delivered: USDC released to seller", escrow_id);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deliver")),
            (escrow_id, escrow.seller.clone(), escrow.amount),
        );

        Ok(())
    }

    // ------------------------------------------------------------------------
    // claim_refund
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

        log!(&env, "Oracle updated to {}", new_oracle);

        Ok(())
    }

    // ------------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------------

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
