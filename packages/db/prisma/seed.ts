/**
 * packages/db/prisma/seed.ts
 *
 * Seeds the local dev database with test users and escrows.
 * Run with: pnpm prisma db seed
 */

import { PrismaClient, EscrowStatus, CourierCode } from '@prisma/client'

const prisma = new PrismaClient()

// Test Stellar addresses (testnet keypairs — DO NOT use on mainnet)
const BUYER_ADDRESS  = 'GCSIGIFQQR7UQ55EFKSLCPB2CFS7PCMULYFBWEMPXJ6V2FR6RTZDLCRZ'
const SELLER_ADDRESS = 'GC3SSVNBKDJXYNQXFB6MQABEQOXXQXZ4ZQDG5GV5ZQFBIFHLQRB4A3GA'

// Contract + network constants (match .env.local)
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? 'CDXU2C4KKP7M2NCQM2SD73I7H4UMCU6STLGAF66WPDFOTNYGFENIZV6Z'

async function main() {
  console.log('🌱 Seeding database...')

  // ── 1. Users ──────────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where:  { stellarAddress: BUYER_ADDRESS },
    update: {},
    create: { stellarAddress: BUYER_ADDRESS, displayName: 'Test Buyer' },
  })

  await prisma.user.upsert({
    where:  { stellarAddress: SELLER_ADDRESS },
    update: {},
    create: { stellarAddress: SELLER_ADDRESS, displayName: 'Test Seller' },
  })

  console.log('  ✓ Users created')

  // ── 2. QRIS Session ───────────────────────────────────────────────────────
  const qrisSession = await prisma.qrisSession.create({
    data: {
      payloadRaw:   '00020101021126560014ID.CO.BNI.WWW011893600009150000000000302UBE5204000053033605802ID5920Merchant Test Store6013Jakarta Pusat6105104406304ABCD',
      merchantId:   'ID.CO.BNI.WWW',
      merchantName: 'Merchant Test Store',
      catCode:      '0000',
      amount:       750000,
    },
  })

  console.log('  ✓ QRIS session created:', qrisSession.id)

  // ── 3. Escrow — FUNDED (ready for tracking) ───────────────────────────────
  const fundedEscrow = await prisma.escrow.create({
    data: {
      contractEscrowId: 1n,
      contractAddress:  CONTRACT_ADDRESS,
      buyerAddress:     BUYER_ADDRESS,
      sellerAddress:    SELLER_ADDRESS,
      amountUsdc:       50,   // 50 USDC
      status:           EscrowStatus.FUNDED,
      qrisMerchantId:   'ID.CO.BNI.WWW',
      qrisMerchantName: 'Merchant Test Store',
      qrisPayloadRaw:   qrisSession.payloadRaw,
      timeoutAt:        new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 h from now
      fundedAt:         new Date(),
      txHashFund:       'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011',
    },
  })

  // Link the QRIS session to the escrow
  await prisma.qrisSession.update({
    where: { id: qrisSession.id },
    data:  { escrowId: fundedEscrow.id },
  })

  console.log('  ✓ Funded escrow created:', fundedEscrow.id)

  // ── 4. Escrow — SHIPPED (oracle should pick this up) ─────────────────────
  const shippedEscrow = await prisma.escrow.create({
    data: {
      contractEscrowId: 2n,
      contractAddress:  CONTRACT_ADDRESS,
      buyerAddress:     BUYER_ADDRESS,
      sellerAddress:    SELLER_ADDRESS,
      amountUsdc:       25,   // 25 USDC
      status:           EscrowStatus.SHIPPED,
      trackingNumber:   'JT12345678',
      courierCode:      CourierCode.JNT,
      qrisMerchantName: 'Test Electronics Shop',
      timeoutAt:        new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 h from now
      fundedAt:         new Date(Date.now() - 60 * 60 * 1000),      // funded 1 h ago
      shippedAt:        new Date(Date.now() - 30 * 60 * 1000),      // shipped 30 min ago
    },
  })

  console.log('  ✓ Shipped escrow created:', shippedEscrow.id, '(oracle should track JT12345678)')

  // ── 5. Escrow — DELIVERED (historical) ───────────────────────────────────
  await prisma.escrow.create({
    data: {
      contractEscrowId: 3n,
      contractAddress:  CONTRACT_ADDRESS,
      buyerAddress:     BUYER_ADDRESS,
      sellerAddress:    SELLER_ADDRESS,
      amountUsdc:       100,
      status:           EscrowStatus.DELIVERED,
      trackingNumber:   'SICEPAT99887766',
      courierCode:      CourierCode.SICEPAT,
      timeoutAt:        new Date(Date.now() + 48 * 60 * 60 * 1000),
      fundedAt:         new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      shippedAt:        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      deliveredAt:      new Date(Date.now() - 12 * 60 * 60 * 1000),
      txHashFund:       'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00',
      txHashRelease:    'ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11',
    },
  })

  console.log('  ✓ Delivered escrow created (historical)')

  // ── 6. Notifications ──────────────────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      // Seller notifications
      {
        userAddress: SELLER_ADDRESS,
        type:        'ESCROW_CREATED',
        message:     'Escrow baru dibuat untuk 50 USDC. Menunggu pembayaran dari pembeli.',
        read:        true,
      },
      {
        userAddress: SELLER_ADDRESS,
        type:        'ESCROW_FUNDED',
        message:     'Escrow telah didanai! Silakan kirim paket dan masukkan nomor resi.',
        read:        false,
      },
      // Buyer notifications (your Freighter address)
      {
        userAddress: BUYER_ADDRESS,
        type:        'ESCROW_CREATED',
        message:     'Escrow berhasil dibuat untuk 50 USDC ke Merchant Test Store.',
        read:        true,
      },
      {
        userAddress: BUYER_ADDRESS,
        type:        'ESCROW_SHIPPED',
        message:     'Paket telah dikirim oleh penjual! Resi: JT12345678 (J&T Express). Dana akan dilepas otomatis setelah konfirmasi pengiriman.',
        read:        false,
      },
      {
        userAddress: BUYER_ADDRESS,
        type:        'ESCROW_DELIVERED',
        message:     'Paket telah sampai dan dikonfirmasi. Dana sebesar 100 USDC telah dilepas ke penjual.',
        read:        false,
      },
    ],
  })

  console.log('  ✓ Notifications created')
  console.log('\n✅ Seed complete!')
  console.log('\nTest credentials:')
  console.log('  Buyer address: ', BUYER_ADDRESS)
  console.log('  Seller address:', SELLER_ADDRESS)
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
