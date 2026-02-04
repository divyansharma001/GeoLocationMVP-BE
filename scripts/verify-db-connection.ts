import { PrismaClient } from '@prisma/client';

async function testConnection(url: string, label: string) {
    console.log(`\nTesting ${label}...`);
    const maskedUrl = url.replace(/:([^:@]+)@/, ':****@');
    console.log(`URL: ${maskedUrl}`);

    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: url,
            },
        },
    });

    try {
        await prisma.$connect();
        console.log(`✅ ${label}: Connection successful!`);
        const userCount = await prisma.user.count();
        console.log(`✅ ${label}: Query successful! Found ${userCount} users.`);
        return true;
    } catch (error: any) {
        console.error(`❌ ${label}: Connection failed.`);
        console.error('Error message:', error.message);
        return false;
    } finally {
        await prisma.$disconnect();
    }
}

async function main() {
    // 1. Test the user-provided 'yohopusr' credentials
    const url1 = "postgresql://yohopusr:YoHopE3Rb%23cYvQG@76.13.96.229:5432/yohopdb?schema=public&sslmode=prefer";

    // 2. Test the 'pguser' credentials (which worked previously for authentication) pointing to the correct DB
    // Note: Using the password from the original env file
    const url2 = "postgresql://pguser:69E3Rb%23cYvQG@76.13.96.229:5432/yohopdb?schema=public&sslmode=prefer";

    await testConnection(url1, "USER: yohopusr | DB: yohopdb");
    await testConnection(url2, "USER: pguser   | DB: yohopdb");
}

main();
