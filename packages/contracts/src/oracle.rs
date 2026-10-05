#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Map, Vec};

/// Represents a staked oracle node in the decentralized network.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OracleNode {
    pub node_address: Address,
    pub staked_amount: i128,
    pub is_active: bool,
    pub reputation_score: u32,
}

/// Represents a request for courier tracking verification.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VerificationRequest {
    pub escrow_id: u64,
    pub tracking_number: String,
    pub courier_code: String,
    pub confirmations_required: u32,
    pub current_confirmations: u32,
    pub is_resolved: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Nodes(Address), // Maps node address to OracleNode
    Requests(u64),  // Maps escrow_id to VerificationRequest
}

#[contract]
pub struct TitipDecentralizedOracle;

/// Blueprint for v2.0 Decentralized Oracle Network with Staking
/// This contract coordinates multiple independent oracle nodes to verify courier shipments,
/// ensuring trustless off-chain data feeds through staking and slashing.
#[contractimpl]
impl TitipDecentralizedOracle {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Nodes stake USDC to join the decentralized oracle network.
    pub fn stake_node(env: Env, node: Address, amount: i128) {
        node.require_auth();
        
        // In reality, this would transfer USDC from `node` to this contract.
        
        let new_node = OracleNode {
            node_address: node.clone(),
            staked_amount: amount,
            is_active: true,
            reputation_score: 100, // starting score
        };

        env.storage().persistent().set(&DataKey::Nodes(node), &new_node);
    }

    /// Called by the Escrow Contract to request decentralized verification.
    pub fn request_verification(env: Env, escrow_id: u64, tracking_number: String, courier_code: String) {
        let request = VerificationRequest {
            escrow_id,
            tracking_number,
            courier_code,
            confirmations_required: 3, // Requires 3 independent nodes to agree
            current_confirmations: 0,
            is_resolved: false,
        };

        env.storage().persistent().set(&DataKey::Requests(escrow_id), &request);
    }

    /// Called by an active Oracle Node to submit their finding (e.g. "Delivered").
    pub fn submit_verification(env: Env, node: Address, escrow_id: u64, is_delivered: bool) {
        node.require_auth();

        let node_data: OracleNode = env.storage().persistent().get(&DataKey::Nodes(node.clone())).unwrap();
        if !node_data.is_active || node_data.staked_amount < 1000_0000000 {
            panic!("Node inactive or insufficient stake");
        }

        let mut request: VerificationRequest = env.storage().persistent().get(&DataKey::Requests(escrow_id)).unwrap();
        
        if is_delivered {
            request.current_confirmations += 1;
            
            if request.current_confirmations >= request.confirmations_required {
                request.is_resolved = true;
                // Here it would use Cross-Contract Calls (invoke_contract) to call `confirm_delivery` on the main Escrow contract
            }
            
            env.storage().persistent().set(&DataKey::Requests(escrow_id), &request);
        }
    }

    /// Admin function to slash a malicious node's stake and remove them from the network.
    pub fn slash_node(env: Env, node: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut node_data: OracleNode = env.storage().persistent().get(&DataKey::Nodes(node.clone())).unwrap();
        node_data.is_active = false;
        node_data.staked_amount = 0; // Slashing the stake
        node_data.reputation_score = 0;

        env.storage().persistent().set(&DataKey::Nodes(node), &node_data);
    }
}
