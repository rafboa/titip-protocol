import { prisma } from '../packages/db/src/index.ts';

async function main() {
  const e = await prisma.escrow.findUnique({
    where: { id: 'cmrma6f530005u92kmuc5xz48' }
  });
  console.log(e);
  await prisma.$disconnect();
}

main();
