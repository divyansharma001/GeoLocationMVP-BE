/**
 * Streak Feature Demo Script
 * 
 * This script demonstrates the streak functionality
 * Run with: npx ts-node scripts/demo-streak.ts
 */

import prisma from '../src/lib/prisma';
import {
  updateStreakAfterCheckIn,
  getStreakInfo,
  calculateDiscountPercentage,
  applyStreakDiscount,
} from '../src/lib/streak';

async function main() {
  console.log('🔥 Streak Feature Demo\n');
  console.log('=' .repeat(60));

  // Find or create a test user
  let user = await prisma.user.findFirst({
    where: { email: 'demo@test.com' },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'demo@test.com',
        name: 'Demo User',
        password: 'hashedpassword123',
      },
    });
    console.log('✅ Created demo user:', user.email);
  } else {
    console.log('✅ Using existing user:', user.email);
  }

  console.log('\n📊 DISCOUNT TIERS');
  console.log('=' .repeat(60));
  for (let week = 1; week <= 7; week++) {
    const discount = calculateDiscountPercentage(week);
    console.log(`Week ${week}: ${discount}% off`);
  }

  console.log('\n\n🎮 SIMULATING STREAK PROGRESSION');
  console.log('=' .repeat(60));

  // Simulate check-ins over multiple weeks
  const startDate = new Date('2025-01-06'); // A Monday
  
  for (let week = 0; week < 5; week++) {
    const checkInDate = new Date(startDate);
    checkInDate.setDate(checkInDate.getDate() + (week * 7));
    
    console.log(`\n📍 Week ${week + 1} Check-in (${checkInDate.toDateString()})`);
    
    const result = await updateStreakAfterCheckIn(user.id, checkInDate);
    
    console.log(`   Streak: ${result.streak.currentStreak} weeks`);
    console.log(`   Discount: ${result.discountPercent}%`);
    console.log(`   Message: ${result.message}`);
    
    if (result.newWeek) {
      console.log('   ✨ New week bonus!');
    }
  }

  // Show current streak info
  console.log('\n\n📈 CURRENT STREAK STATUS');
  console.log('=' .repeat(60));
  const streakInfo = await getStreakInfo(user.id);
  console.log(`Current Streak: ${streakInfo.currentStreak} weeks`);
  console.log(`Longest Streak: ${streakInfo.longestStreak} weeks`);
  console.log(`Current Discount: ${streakInfo.currentDiscountPercent}%`);
  console.log(`Total Check-ins: ${streakInfo.totalCheckIns}`);
  console.log(`Next Week Discount: ${streakInfo.nextWeekDiscountPercent}%`);
  console.log(`Weeks Until Max: ${streakInfo.weeksUntilMaxDiscount}`);
  console.log(`Max Discount Reached: ${streakInfo.maxDiscountReached ? 'Yes 🎉' : 'No'}`);

  // Demonstrate discount application
  console.log('\n\n💰 DISCOUNT CALCULATION EXAMPLES');
  console.log('=' .repeat(60));
  
  const orderAmounts = [25, 50, 100];
  for (const amount of orderAmounts) {
    const discount = applyStreakDiscount(amount, streakInfo.currentDiscountPercent);
    console.log(`\nOrder Amount: $${amount.toFixed(2)}`);
    console.log(`Discount (${discount.discountPercent}%): -$${discount.discountAmount.toFixed(2)}`);
    console.log(`Final Amount: $${discount.finalAmount.toFixed(2)}`);
  }

  // Simulate a missed week (streak break)
  console.log('\n\n❌ SIMULATING MISSED WEEK');
  console.log('=' .repeat(60));
  const missedDate = new Date(startDate);
  missedDate.setDate(missedDate.getDate() + (7 * 7)); // 7 weeks later (missing week 6)
  
  console.log(`Check-in after missing a week (${missedDate.toDateString()})`);
  const missedResult = await updateStreakAfterCheckIn(user.id, missedDate);
  console.log(`Streak Broken: ${missedResult.streakBroken ? 'Yes' : 'No'}`);
  console.log(`New Streak: ${missedResult.streak.currentStreak} weeks`);
  console.log(`New Discount: ${missedResult.discountPercent}%`);
  console.log(`Message: ${missedResult.message}`);

  // Continue to max streak
  console.log('\n\n🏆 REACHING MAXIMUM STREAK');
  console.log('=' .repeat(60));
  
  const continueDate = new Date(missedDate);
  for (let week = 1; week < 8; week++) {
    continueDate.setDate(continueDate.getDate() + 7);
    await updateStreakAfterCheckIn(user.id, continueDate);
  }

  const finalStreak = await getStreakInfo(user.id);
  console.log(`Final Streak: ${finalStreak.currentStreak} weeks`);
  console.log(`Final Discount: ${finalStreak.currentDiscountPercent}%`);
  console.log(`Max Reached: ${finalStreak.maxDiscountReached ? 'Yes! 🎉' : 'No'}`);

  console.log('\n\n✅ DEMO COMPLETE!');
  console.log('=' .repeat(60));
  console.log('\nCheck the database to see the UserStreak record:');
  console.log(`User ID: ${user.id}`);
  console.log(`Email: ${user.email}`);
  console.log('\nTry these API endpoints:');
  console.log('- GET /api/streak (get your streak)');
  console.log('- GET /api/streak/leaderboard (see top streaks)');
  console.log('- POST /api/streak/calculate-discount (calculate order discount)');
  console.log('- GET /api/streak/discount-tiers (see all tiers)');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Error running demo:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
