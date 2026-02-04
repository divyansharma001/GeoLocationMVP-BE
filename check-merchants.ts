import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const merchants = await prisma.merchant.findMany({
        select: {
            id: true,
            businessName: true,
            status: true,
        },
    });
    console.log('Merchants in DB:', JSON.stringify(merchants, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
