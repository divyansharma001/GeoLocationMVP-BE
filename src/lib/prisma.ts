// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 20000, // 20 seconds max wait
    timeout: 20000, // 20 seconds timeout
  },
});

export default prisma;
