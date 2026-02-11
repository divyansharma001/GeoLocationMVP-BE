/**
 * Master Seed Script — seeds EVERYTHING in the correct order:
 *   1. Deal Categories
 *   2. Deal Types
 *   3. Users (consumers + merchant owners + admin)
 *   4. Merchants (linked to merchant-role users)
 *   5. Cities
 *   6. Stores (link merchants ↔ cities)
 *   7. Deals (various types)
 *   8. Gamification (achievements, loyalty tiers)
 *   9. Nudges
 *  10. Events + ticket tiers + add-ons
 *
 * Run: npx ts-node scripts/seed-all.ts
 */

import prisma from '../src/lib/prisma';
import bcrypt from 'bcryptjs';
import {
  UserRole,
  MerchantStatus,
  BusinessType,
  EventStatus,
  EventType,
  TicketTier,
  AchievementType,
  LoyaltyTier,
  NudgeType,
  NudgeFrequency,
} from '@prisma/client';

const PASSWORD = 'Test@1234';

async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

// ─── 1. Deal Categories ─────────────────────────────────────────

async function seedDealCategories() {
  console.log('\n📂 Seeding deal categories...');
  const categories = [
    { name: 'Food & Beverage', description: 'Restaurants, bars, cafes', icon: '🍔', color: '#FF6B35', sortOrder: 1 },
    { name: 'Entertainment', description: 'Clubs, concerts, shows', icon: '🎵', color: '#8B5CF6', sortOrder: 2 },
    { name: 'Nightlife', description: 'Bars, lounges, nightclubs', icon: '🌙', color: '#1E40AF', sortOrder: 3 },
    { name: 'Retail', description: 'Shopping, fashion, goods', icon: '🛍️', color: '#059669', sortOrder: 4 },
    { name: 'Health & Fitness', description: 'Gyms, wellness, spas', icon: '💪', color: '#DC2626', sortOrder: 5 },
    { name: 'Beauty & Spa', description: 'Salons, spas, grooming', icon: '💅', color: '#DB2777', sortOrder: 6 },
  ];

  for (const cat of categories) {
    await prisma.dealCategoryMaster.upsert({
      where: { name: cat.name },
      update: { description: cat.description, icon: cat.icon, color: cat.color, sortOrder: cat.sortOrder },
      create: cat,
    });
  }
  console.log(`  ✅ ${categories.length} deal categories ready`);
}

// ─── 2. Deal Types ──────────────────────────────────────────────

async function seedDealTypes() {
  console.log('\n🏷️  Seeding deal types...');
  const dealTypes = [
    { name: 'Standard', description: 'Standard promotional deal — one-time promotions', active: true },
    { name: 'Happy Hour', description: 'Time-based daily specials from Happy Hour menu items only', active: true },
    { name: 'Bounty Deal', description: 'Rewards customers with cash back when they bring friends', active: true },
    { name: 'Hidden Deal', description: 'Secret VIP deals accessible via code, link, or QR', active: true },
    { name: 'Redeem Now', description: 'Flash sale with customizable discount', active: true },
    { name: 'Recurring Deal', description: 'Daily deals that recur on specific days of the week', active: true },
  ];

  for (const dt of dealTypes) {
    await prisma.dealTypeMaster.upsert({
      where: { name: dt.name },
      update: { description: dt.description, active: dt.active },
      create: dt,
    });
  }
  console.log(`  ✅ ${dealTypes.length} deal types ready`);
}

// ─── 3. Users ───────────────────────────────────────────────────

async function seedUsers() {
  console.log('\n👤 Seeding users...');
  const hashed = await hashPassword(PASSWORD);

  const users = [
    // Consumers
    { email: 'alex@test.com', name: 'Alex Johnson', role: UserRole.USER, points: 150, coins: 500, experiencePoints: 800, loyaltyTier: LoyaltyTier.SILVER },
    { email: 'maria@test.com', name: 'Maria Garcia', role: UserRole.USER, points: 50, coins: 200, experiencePoints: 300 },
    { email: 'james@test.com', name: 'James Williams', role: UserRole.USER, points: 300, coins: 1200, experiencePoints: 2000, loyaltyTier: LoyaltyTier.GOLD },
    { email: 'priya@test.com', name: 'Priya Patel', role: UserRole.USER, points: 20, coins: 100, experiencePoints: 150 },
    { email: 'david@test.com', name: 'David Chen', role: UserRole.USER, points: 80, coins: 350, experiencePoints: 500 },

    // Merchant owners
    { email: 'merchant1@test.com', name: 'Tony Stark', role: UserRole.MERCHANT, points: 0 },
    { email: 'merchant2@test.com', name: 'Jessica Rivera', role: UserRole.MERCHANT, points: 0 },
    { email: 'merchant3@test.com', name: 'Raj Malhotra', role: UserRole.MERCHANT, points: 0 },
    { email: 'merchant4@test.com', name: 'Sarah Kim', role: UserRole.MERCHANT, points: 0 },

    // Admin
    { email: 'admin@test.com', name: 'Admin User', role: UserRole.ADMIN, points: 0 },

    // Event organizer
    { email: 'organizer@test.com', name: 'DJ Nightfall', role: UserRole.EVENT_ORGANIZER, points: 0 },
  ];

  const createdUsers: { id: number; email: string; role: UserRole }[] = [];

  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      createdUsers.push({ id: existing.id, email: existing.email, role: existing.role });
      continue;
    }
    const user = await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        password: hashed,
        role: u.role,
        points: u.points || 0,
        coins: u.coins || 0,
        experiencePoints: u.experiencePoints || 0,
        loyaltyTier: u.loyaltyTier || LoyaltyTier.BRONZE,
        emailVerifiedAt: new Date(),
        referralCode: u.email.split('@')[0].toUpperCase() + Math.floor(Math.random() * 1000),
      },
    });
    createdUsers.push({ id: user.id, email: user.email, role: user.role });
  }

  console.log(`  ✅ ${createdUsers.length} users ready`);
  console.log(`     Login: any email above / password: ${PASSWORD}`);
  return createdUsers;
}

// ─── 4. Merchants ───────────────────────────────────────────────

async function seedMerchants(users: { id: number; email: string; role: UserRole }[]) {
  console.log('\n🏪 Seeding merchants...');
  const merchantOwners = users.filter((u) => u.role === UserRole.MERCHANT);

  const merchantsData = [
    {
      ownerEmail: 'merchant1@test.com',
      businessName: 'The Velvet Lounge',
      address: '420 Collins Ave, Miami Beach, FL 33139',
      description: 'Upscale cocktail bar with live DJs every weekend. Craft cocktails, bottle service, and an intimate rooftop vibe.',
      phoneNumber: '+1-305-555-0101',
      latitude: 25.7907,
      longitude: -80.1300,
      city: 'Miami',
      logoUrl: 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=200',
      businessType: BusinessType.LOCAL,
    },
    {
      ownerEmail: 'merchant2@test.com',
      businessName: 'Spice Route Kitchen',
      address: '1500 Broadway, New York, NY 10036',
      description: 'Modern Indian fusion restaurant in Times Square. Award-winning cocktails, live music nights, and a globally-inspired menu.',
      phoneNumber: '+1-212-555-0202',
      latitude: 40.7580,
      longitude: -73.9855,
      city: 'New York City',
      logoUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=200',
      businessType: BusinessType.LOCAL,
    },
    {
      ownerEmail: 'merchant3@test.com',
      businessName: 'Neon Nights Club',
      address: '800 W 6th St, Austin, TX 78703',
      description: 'Austin\'s premier electronic music venue. State-of-the-art sound system, immersive light shows, and weekly themed nights.',
      phoneNumber: '+1-512-555-0303',
      latitude: 30.2729,
      longitude: -97.7544,
      city: 'Austin',
      logoUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=200',
      businessType: BusinessType.LOCAL,
    },
    {
      ownerEmail: 'merchant4@test.com',
      businessName: 'Sunset Taco Co.',
      address: '3000 Main St, Dallas, TX 75226',
      description: 'Authentic street tacos meets craft beer garden. Daily happy hours, Taco Tuesday specials, and a rooftop patio.',
      phoneNumber: '+1-214-555-0404',
      latitude: 32.7767,
      longitude: -96.7970,
      city: 'Dallas',
      logoUrl: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200',
      businessType: BusinessType.LOCAL,
    },
  ];

  const createdMerchants: { id: number; ownerId: number; businessName: string; latitude: number | null; longitude: number | null }[] = [];

  for (const m of merchantsData) {
    const owner = merchantOwners.find((u) => u.email === m.ownerEmail);
    if (!owner) continue;

    const existing = await prisma.merchant.findUnique({ where: { ownerId: owner.id } });
    if (existing) {
      createdMerchants.push({ id: existing.id, ownerId: existing.ownerId, businessName: existing.businessName, latitude: existing.latitude, longitude: existing.longitude });
      continue;
    }

    const merchant = await prisma.merchant.create({
      data: {
        businessName: m.businessName,
        address: m.address,
        description: m.description,
        phoneNumber: m.phoneNumber,
        latitude: m.latitude,
        longitude: m.longitude,
        city: m.city,
        logoUrl: m.logoUrl,
        businessType: m.businessType,
        status: MerchantStatus.APPROVED,
        ownerId: owner.id,
      },
    });
    createdMerchants.push({ id: merchant.id, ownerId: merchant.ownerId, businessName: merchant.businessName, latitude: merchant.latitude, longitude: merchant.longitude });
  }

  console.log(`  ✅ ${createdMerchants.length} merchants ready`);
  return createdMerchants;
}

// ─── 5. Cities ──────────────────────────────────────────────────

async function seedCities() {
  console.log('\n🏙️  Seeding cities...');
  const cities = [
    { name: 'Miami', state: 'Florida', active: true },
    { name: 'Orlando', state: 'Florida', active: true },
    { name: 'Tampa', state: 'Florida', active: true },
    { name: 'Atlanta', state: 'Georgia', active: true },
    { name: 'New York City', state: 'New York', active: true },
    { name: 'Dallas', state: 'Texas', active: true },
    { name: 'Houston', state: 'Texas', active: true },
    { name: 'Austin', state: 'Texas', active: true },
    { name: 'Los Angeles', state: 'California', active: false },
    { name: 'Seattle', state: 'Washington', active: true },
  ];

  const createdCities: { id: number; name: string }[] = [];

  for (const c of cities) {
    const city = await prisma.city.upsert({
      where: { name_state: { name: c.name, state: c.state } },
      update: { active: c.active },
      create: c,
    });
    createdCities.push({ id: city.id, name: city.name });
  }

  console.log(`  ✅ ${createdCities.length} cities ready`);
  return createdCities;
}

// ─── 6. Stores ──────────────────────────────────────────────────

async function seedStores(
  merchants: { id: number; businessName: string; latitude: number | null; longitude: number | null }[],
  cities: { id: number; name: string }[],
) {
  console.log('\n🏬 Seeding stores...');
  const storeLinks = [
    { merchantBiz: 'The Velvet Lounge', cityName: 'Miami' },
    { merchantBiz: 'Spice Route Kitchen', cityName: 'New York City' },
    { merchantBiz: 'Neon Nights Club', cityName: 'Austin' },
    { merchantBiz: 'Sunset Taco Co.', cityName: 'Dallas' },
  ];

  let count = 0;
  for (const link of storeLinks) {
    const merchant = merchants.find((m) => m.businessName === link.merchantBiz);
    const city = cities.find((c) => c.name === link.cityName);
    if (!merchant || !city) continue;

    const existing = await prisma.store.findFirst({
      where: { merchantId: merchant.id, cityId: city.id },
    });
    if (existing) { count++; continue; }

    await prisma.store.create({
      data: {
        merchantId: merchant.id,
        cityId: city.id,
        address: `${merchant.businessName} — ${link.cityName}`,
        latitude: merchant.latitude,
        longitude: merchant.longitude,
        active: true,
      },
    });
    count++;
  }
  console.log(`  ✅ ${count} stores ready`);
}

// ─── 7. Deals ───────────────────────────────────────────────────

async function seedDeals(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n🎫 Seeding deals...');

  const categories = await prisma.dealCategoryMaster.findMany();
  const dealTypes = await prisma.dealTypeMaster.findMany();

  const catId = (name: string) => categories.find((c) => c.name.includes(name))?.id ?? categories[0].id;
  const typeId = (name: string) => dealTypes.find((t) => t.name === name)?.id ?? dealTypes[0].id;

  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

  const dealsData = [
    // Velvet Lounge deals
    {
      merchantBiz: 'The Velvet Lounge',
      title: '2-for-1 Craft Cocktails',
      description: 'Buy one craft cocktail and get the second free! Enjoy our signature drinks with a friend every weeknight.',
      categoryName: 'Food',
      dealTypeName: 'Standard',
      discountPercentage: 50,
      startTime: inDays(-2),
      endTime: inDays(30),
      redemptionInstructions: 'Show this deal at the bar. Valid for one use per customer per night.',
      imageUrls: ['https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600'],
    },
    {
      merchantBiz: 'The Velvet Lounge',
      title: 'VIP Rooftop Happy Hour',
      description: 'Half-price drinks on the rooftop from 5–8 PM daily. Live acoustic sets on Fridays.',
      categoryName: 'Nightlife',
      dealTypeName: 'Happy Hour',
      discountPercentage: 50,
      startTime: inDays(-1),
      endTime: inDays(60),
      redemptionInstructions: 'Ask the host for the rooftop happy hour menu.',
      imageUrls: ['https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=600'],
    },

    // Spice Route deals
    {
      merchantBiz: 'Spice Route Kitchen',
      title: 'Lunch Express — $12.99 Thali',
      description: 'Get a full Indian Thali platter for just $12.99 during lunch hours. Includes appetizer, main course, naan, rice, and dessert.',
      categoryName: 'Food',
      dealTypeName: 'Standard',
      discountAmount: 7.0,
      startTime: inDays(-3),
      endTime: inDays(45),
      redemptionInstructions: 'Mention this deal when ordering. Dine-in only, 11 AM – 3 PM.',
      imageUrls: ['https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=600'],
    },
    {
      merchantBiz: 'Spice Route Kitchen',
      title: 'Bring 3 Friends, Get $20 Back',
      description: 'Invite 3 friends to dine at Spice Route and earn $20 cash back! Each friend gets 10% off their first meal too.',
      categoryName: 'Food',
      dealTypeName: 'Bounty Deal',
      bountyRewardAmount: 20,
      minReferralsRequired: 3,
      startTime: inDays(0),
      endTime: inDays(90),
      redemptionInstructions: 'Share your QR code with friends. Once 3 friends check in, your $20 reward is credited automatically.',
      imageUrls: ['https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600'],
    },

    // Neon Nights deals
    {
      merchantBiz: 'Neon Nights Club',
      title: 'Free Entry Before 11 PM',
      description: 'Skip the cover charge! Show this deal at the door for free entry before 11 PM on any Friday or Saturday night.',
      categoryName: 'Entertainment',
      dealTypeName: 'Standard',
      discountPercentage: 100,
      startTime: inDays(-1),
      endTime: inDays(30),
      redemptionInstructions: 'Show this deal at the entrance before 11 PM.',
      imageUrls: ['https://images.unsplash.com/photo-1571266028243-d220c6ef39e9?w=600'],
    },
    {
      merchantBiz: 'Neon Nights Club',
      title: 'Secret VIP Lounge Access',
      description: 'Unlock the hidden VIP lounge with exclusive cocktails, private DJ booth, and bottle service at 30% off.',
      categoryName: 'Nightlife',
      dealTypeName: 'Hidden Deal',
      discountPercentage: 30,
      accessCode: 'NEONVIP2026',
      startTime: inDays(0),
      endTime: inDays(60),
      redemptionInstructions: 'Whisper the code "NEONVIP2026" to the bartender at the back bar.',
      imageUrls: ['https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600'],
    },

    // Sunset Taco deals
    {
      merchantBiz: 'Sunset Taco Co.',
      title: 'Taco Tuesday — $2 Tacos All Day',
      description: 'Every Tuesday, all tacos are just $2. Choose beef, chicken, pork, or veggie. Limit 10 per person.',
      categoryName: 'Food',
      dealTypeName: 'Recurring Deal',
      discountPercentage: 60,
      recurringDays: 'TUESDAY',
      startTime: inDays(-5),
      endTime: inDays(120),
      redemptionInstructions: 'Just order! All tacos are automatically $2 on Tuesdays.',
      imageUrls: ['https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=600'],
    },
    {
      merchantBiz: 'Sunset Taco Co.',
      title: 'Flash Sale: 50% Off Burritos',
      description: 'Today only — all burritos are half off! Build your own with premium fillings.',
      categoryName: 'Food',
      dealTypeName: 'Redeem Now',
      discountPercentage: 50,
      isFlashSale: true,
      maxRedemptions: 100,
      startTime: now,
      endTime: inDays(3),
      redemptionInstructions: 'Show this deal at checkout. Valid for dine-in and takeout.',
      imageUrls: ['https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=600'],
    },
  ];

  let count = 0;
  for (const d of dealsData) {
    const merchant = merchants.find((m) => m.businessName === d.merchantBiz);
    if (!merchant) continue;

    const existing = await prisma.deal.findFirst({
      where: { merchantId: merchant.id, title: d.title },
    });
    if (existing) { count++; continue; }

    await prisma.deal.create({
      data: {
        title: d.title,
        description: d.description,
        merchantId: merchant.id,
        categoryId: catId(d.categoryName),
        dealTypeId: typeId(d.dealTypeName),
        discountPercentage: d.discountPercentage,
        discountAmount: d.discountAmount,
        startTime: d.startTime,
        endTime: d.endTime,
        redemptionInstructions: d.redemptionInstructions,
        imageUrls: d.imageUrls || [],
        kickbackEnabled: d.dealTypeName === 'Bounty Deal',
        bountyRewardAmount: d.bountyRewardAmount,
        minReferralsRequired: d.minReferralsRequired,
        accessCode: d.accessCode,
        isFlashSale: d.isFlashSale || false,
        maxRedemptions: d.maxRedemptions,
        recurringDays: d.recurringDays,
      },
    });
    count++;
  }
  console.log(`  ✅ ${count} deals ready`);
}

// ─── 8. Gamification ────────────────────────────────────────────

async function seedGamification() {
  console.log('\n🎮 Seeding gamification...');

  const achievements = [
    { name: 'Welcome Aboard!', description: 'Complete your first check-in', type: AchievementType.FIRST_PURCHASE, icon: '🎉', coinReward: 50, xpReward: 100, criteria: { type: 'first_checkin' }, sortOrder: 1 },
    { name: 'Big Spender', description: 'Spend $50 total on deals', type: AchievementType.SPENDING_MILESTONE, icon: '💰', coinReward: 100, xpReward: 200, criteria: { amount: 50 }, sortOrder: 2 },
    { name: 'Premium Player', description: 'Spend $150 total', type: AchievementType.SPENDING_MILESTONE, icon: '💎', coinReward: 250, xpReward: 500, criteria: { amount: 150 }, sortOrder: 3 },
    { name: 'Check-in Champion', description: 'Complete 5 check-ins in a week', type: AchievementType.CHECK_IN_STREAK, icon: '🏆', coinReward: 75, xpReward: 150, criteria: { streak: 5 }, sortOrder: 4 },
    { name: 'Social Butterfly', description: 'Refer 3 friends', type: AchievementType.REFERRAL_COUNT, icon: '🦋', coinReward: 150, xpReward: 300, criteria: { referrals: 3 }, sortOrder: 5 },
    { name: 'VIP Status', description: 'Reach Gold loyalty tier', type: AchievementType.LOYALTY_TIER, icon: '👑', coinReward: 500, xpReward: 1000, criteria: { tier: 'GOLD' }, sortOrder: 6 },
  ];

  for (const a of achievements) {
    await prisma.achievement.upsert({
      where: { name: a.name },
      update: {},
      create: a,
    });
  }
  console.log(`  ✅ ${achievements.length} achievements ready`);
}

// ─── 9. Nudges ──────────────────────────────────────────────────

async function seedNudges() {
  console.log('\n📣 Seeding nudges...');
  const nudges = [
    { type: NudgeType.INACTIVITY, title: 'We miss you! 🎉', message: 'Check out today\'s amazing deals and keep your streak alive.', triggerCondition: { daysInactive: 3 }, frequency: NudgeFrequency.WEEKLY, cooldownHours: 168, active: true, priority: 10 },
    { type: NudgeType.STREAK_REMINDER, title: 'Your streak is at risk! 🔥', message: 'Check in today to keep your streak alive.', triggerCondition: { minStreak: 3 }, frequency: NudgeFrequency.DAILY, cooldownHours: 24, active: true, priority: 20 },
    { type: NudgeType.HAPPY_HOUR_ALERT, title: 'Happy Hour Alert! 🍸', message: 'Your favorite venue\'s happy hour starts soon!', triggerCondition: { minutesBefore: 30 }, frequency: NudgeFrequency.UNLIMITED, cooldownHours: 0, active: true, priority: 15 },
    { type: NudgeType.NEARBY_DEAL, title: 'Great deal nearby! 🎁', message: 'You\'re close to a venue with an amazing deal.', triggerCondition: { radiusMeters: 500 }, frequency: NudgeFrequency.DAILY, cooldownHours: 24, active: true, priority: 25 },
  ];

  for (const n of nudges) {
    const exists = await prisma.nudge.findFirst({ where: { type: n.type, title: n.title } });
    if (!exists) {
      await prisma.nudge.create({ data: n });
    }
  }
  console.log(`  ✅ ${nudges.length} nudges ready`);
}

// ─── 10. Events + Ticket Tiers + Add-ons ────────────────────────

async function seedEvents(
  users: { id: number; email: string; role: UserRole }[],
  merchants: { id: number; businessName: string; latitude: number | null; longitude: number | null }[],
  cities: { id: number; name: string }[],
) {
  console.log('\n🎤 Seeding events...');

  const organizer = users.find((u) => u.role === UserRole.EVENT_ORGANIZER) ?? users.find((u) => u.role === UserRole.MERCHANT) ?? users[0];
  const neonMerchant = merchants.find((m) => m.businessName === 'Neon Nights Club');
  const velvetMerchant = merchants.find((m) => m.businessName === 'The Velvet Lounge');
  const austinCity = cities.find((c) => c.name === 'Austin');
  const miamiCity = cities.find((c) => c.name === 'Miami');

  const eventsToCreate = [
    {
      title: 'Neon Nights: Electronic Festival',
      description: 'Experience the ultimate electronic music festival with world-class DJs, mesmerizing light shows, and an electric atmosphere that will keep you dancing until dawn.',
      shortDescription: 'Downtown\'s biggest electronic music festival',
      eventType: EventType.PARTY,
      status: EventStatus.PUBLISHED,
      venueName: 'Neon Nights Club',
      venueAddress: '800 W 6th St, Austin, TX 78703',
      latitude: neonMerchant?.latitude ?? 30.2729,
      longitude: neonMerchant?.longitude ?? -97.7544,
      startDate: new Date('2026-03-20T21:00:00'),
      endDate: new Date('2026-03-21T03:00:00'),
      maxAttendees: 500,
      currentAttendees: 127,
      enableWaitlist: true,
      waitlistCapacity: 100,
      isFreeEvent: false,
      coverImageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200',
      imageGallery: [
        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600',
        'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=600',
        'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600',
      ],
      videoUrl: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600',
      minAge: 21,
      ageVerificationReq: true,
      tags: ['Electronic', 'DJ', 'Nightlife', 'Festival'],
      socialProofCount: 48,
      trendingScore: 87.5,
      organizerId: organizer.id,
      merchantId: neonMerchant?.id,
      cityId: austinCity?.id,
      publishedAt: new Date(),
      tiers: [
        { name: 'Early Bird GA', tier: TicketTier.EARLY_BIRD, price: 15, serviceFee: 2.5, taxRate: 0.08, totalQuantity: 50, soldQuantity: 46, minPerOrder: 1, maxPerOrder: 4, description: 'Limited early bird pricing — includes express entry' },
        { name: 'General Admission', tier: TicketTier.GENERAL_ADMISSION, price: 35, serviceFee: 5, taxRate: 0.08, totalQuantity: 300, soldQuantity: 81, minPerOrder: 1, maxPerOrder: 6, description: 'Standard entry with access to all stages' },
        { name: 'VIP Backstage', tier: TicketTier.VIP, price: 120, serviceFee: 10, taxRate: 0.08, totalQuantity: 50, soldQuantity: 12, minPerOrder: 1, maxPerOrder: 2, description: 'VIP lounge, private bar, backstage meet & greet' },
      ],
      addOns: [
        { name: 'Express Entry', category: 'PERK', price: 0, isOptional: false, totalQuantity: null, maxPerUser: 1 },
        { name: 'Welcome Drink', category: 'PERK', price: 0, isOptional: false, totalQuantity: null, maxPerUser: 1 },
        { name: 'Free Parking', category: 'PERK', price: 0, isOptional: true, totalQuantity: 100, maxPerUser: 1 },
        { name: 'Photo Booth Pass', category: 'PERK', price: 5, isOptional: true, totalQuantity: 200, maxPerUser: 2 },
        { name: 'Glow Kit', category: 'MERCH', price: 15, isOptional: true, totalQuantity: 150, maxPerUser: 3 },
      ],
    },
    {
      title: 'Velvet Sunset Sessions',
      description: 'Rooftop cocktail evening with live jazz, soulful vocals, and the best sunset view in South Beach. Dressy casual encouraged.',
      shortDescription: 'Rooftop jazz & cocktails with ocean views',
      eventType: EventType.RSVP_EVENT,
      status: EventStatus.PUBLISHED,
      venueName: 'The Velvet Lounge — Rooftop',
      venueAddress: '420 Collins Ave, Miami Beach, FL 33139',
      latitude: velvetMerchant?.latitude ?? 25.7907,
      longitude: velvetMerchant?.longitude ?? -80.1300,
      startDate: new Date('2026-03-15T18:00:00'),
      endDate: new Date('2026-03-15T23:00:00'),
      maxAttendees: 120,
      currentAttendees: 45,
      enableWaitlist: true,
      isFreeEvent: false,
      coverImageUrl: 'https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=1200',
      imageGallery: [
        'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=600',
        'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600',
      ],
      minAge: 21,
      ageVerificationReq: true,
      tags: ['Jazz', 'Cocktails', 'Rooftop', 'Live Music'],
      socialProofCount: 23,
      trendingScore: 65,
      organizerId: organizer.id,
      merchantId: velvetMerchant?.id,
      cityId: miamiCity?.id,
      publishedAt: new Date(),
      tiers: [
        { name: 'Pre-Sale GA', tier: TicketTier.EARLY_BIRD, price: 25, serviceFee: 3, taxRate: 0.07, totalQuantity: 40, soldQuantity: 38, minPerOrder: 1, maxPerOrder: 2, description: 'Early access pricing' },
        { name: 'General Entry', tier: TicketTier.GENERAL_ADMISSION, price: 45, serviceFee: 5, taxRate: 0.07, totalQuantity: 60, soldQuantity: 7, minPerOrder: 1, maxPerOrder: 4, description: 'Standard rooftop access' },
        { name: 'VIP Table', tier: TicketTier.VIP, price: 200, serviceFee: 15, taxRate: 0.07, totalQuantity: 10, soldQuantity: 3, minPerOrder: 1, maxPerOrder: 1, description: 'Reserved table for 4, complimentary bottle, priority service' },
      ],
      addOns: [
        { name: 'Welcome Cocktail', category: 'PERK', price: 0, isOptional: false, totalQuantity: null, maxPerUser: 1 },
        { name: 'Dessert Pairing', category: 'FOOD', price: 12, isOptional: true, totalQuantity: 50, maxPerUser: 2 },
      ],
    },
    {
      title: 'Free Open Mic Night',
      description: 'Open mic for comedians, poets, singers, and storytellers. Free entry, $3 craft beers all night. Sign up at the door!',
      shortDescription: 'Free comedy & music open mic night',
      eventType: EventType.RSVP_EVENT,
      status: EventStatus.PUBLISHED,
      venueName: 'Sunset Taco Co. — Patio Stage',
      venueAddress: '3000 Main St, Dallas, TX 75226',
      latitude: 32.7767,
      longitude: -96.7970,
      startDate: new Date('2026-02-28T19:00:00'),
      endDate: new Date('2026-02-28T23:00:00'),
      maxAttendees: 80,
      currentAttendees: 12,
      enableWaitlist: false,
      isFreeEvent: true,
      coverImageUrl: 'https://images.unsplash.com/photo-1516280030429-27679b3dc9cf?w=1200',
      imageGallery: [],
      tags: ['Open Mic', 'Comedy', 'Free', 'Live Music'],
      socialProofCount: 8,
      trendingScore: 30,
      organizerId: organizer.id,
      merchantId: merchants.find((m) => m.businessName === 'Sunset Taco Co.')?.id,
      cityId: cities.find((c) => c.name === 'Dallas')?.id,
      publishedAt: new Date(),
      tiers: [
        { name: 'Free Entry', tier: TicketTier.GENERAL_ADMISSION, price: 0, serviceFee: 0, taxRate: 0, totalQuantity: 80, soldQuantity: 12, minPerOrder: 1, maxPerOrder: 4, description: 'Free general admission' },
      ],
      addOns: [],
    },
    {
      title: 'Saturday Night Drag Brunch',
      description: 'Champagne, drag performances, and a full brunch menu. The most fabulous Saturday afternoon in Austin!',
      shortDescription: 'Drag brunch with champagne & performances',
      eventType: EventType.PARTY,
      status: EventStatus.PUBLISHED,
      venueName: 'Neon Nights Club — Lounge',
      venueAddress: '800 W 6th St, Austin, TX 78703',
      latitude: 30.2729,
      longitude: -97.7544,
      startDate: new Date('2026-04-04T11:00:00'),
      endDate: new Date('2026-04-04T15:00:00'),
      maxAttendees: 100,
      currentAttendees: 0,
      enableWaitlist: true,
      isFreeEvent: false,
      coverImageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200',
      imageGallery: ['https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600'],
      tags: ['Brunch', 'Drag', 'LGBTQ+', 'Party'],
      socialProofCount: 5,
      trendingScore: 40,
      organizerId: organizer.id,
      merchantId: neonMerchant?.id,
      cityId: austinCity?.id,
      publishedAt: new Date(),
      tiers: [
        { name: 'General Seat', tier: TicketTier.GENERAL_ADMISSION, price: 40, serviceFee: 5, taxRate: 0.08, totalQuantity: 80, soldQuantity: 0, minPerOrder: 1, maxPerOrder: 6, description: 'Communal table seating with performance view' },
        { name: 'Front Row VIP', tier: TicketTier.VIP, price: 80, serviceFee: 8, taxRate: 0.08, totalQuantity: 20, soldQuantity: 0, minPerOrder: 1, maxPerOrder: 2, description: 'Front row reserved seats, complimentary champagne' },
      ],
      addOns: [
        { name: 'Bottomless Mimosas', category: 'DRINK', price: 18, isOptional: true, totalQuantity: 60, maxPerUser: 1 },
        { name: 'Meet & Greet Pass', category: 'PERK', price: 10, isOptional: true, totalQuantity: 30, maxPerUser: 1 },
      ],
    },
  ];

  let count = 0;
  for (const e of eventsToCreate) {
    const existing = await prisma.event.findFirst({ where: { title: e.title } });
    if (existing) {
      console.log(`  ⏭  "${e.title}" already exists — skipping`);
      count++;
      continue;
    }

    const { tiers, addOns, ...eventData } = e;
    const event = await prisma.event.create({
      data: {
        ...eventData,
        organizerId: eventData.organizerId,
        merchantId: eventData.merchantId ?? undefined,
        cityId: eventData.cityId ?? undefined,
      },
    });
    console.log(`  ✅ Created event: "${event.title}" (ID: ${event.id})`);

    for (const tier of tiers) {
      await prisma.eventTicketTier.create({
        data: { eventId: event.id, ...tier, reservedQuantity: 0 },
      });
    }
    console.log(`     └─ ${tiers.length} ticket tier(s)`);

    for (const addOn of addOns) {
      await prisma.eventAddOn.create({
        data: {
          eventId: event.id,
          name: addOn.name,
          description: null,
          category: addOn.category,
          price: addOn.price,
          isOptional: addOn.isOptional,
          totalQuantity: addOn.totalQuantity,
          soldQuantity: 0,
          maxPerUser: addOn.maxPerUser,
          isActive: true,
        },
      });
    }
    if (addOns.length > 0) console.log(`     └─ ${addOns.length} add-on(s)`);
    count++;
  }

  console.log(`  ✅ ${count} events ready`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log('═════════════════════════════════════════════');
  console.log('  🌱 MASTER SEED — Seeding Everything');
  console.log('═════════════════════════════════════════════');

  try {
    // 1 & 2: Lookup data
    await seedDealCategories();
    await seedDealTypes();

    // 3: Users
    const users = await seedUsers();

    // 4: Merchants
    const merchants = await seedMerchants(users);

    // 5: Cities
    const cities = await seedCities();

    // 6: Stores
    await seedStores(merchants, cities);

    // 7: Deals
    await seedDeals(merchants);

    // 8: Gamification
    await seedGamification();

    // 9: Nudges
    await seedNudges();

    // 10: Events
    await seedEvents(users, merchants, cities);

    // ─── Summary ──────────────────────────────────────
    console.log('\n═════════════════════════════════════════════');
    console.log('  ✅ ALL SEED DATA CREATED SUCCESSFULLY');
    console.log('═════════════════════════════════════════════');

    const counts = {
      users: await prisma.user.count(),
      merchants: await prisma.merchant.count(),
      cities: await prisma.city.count(),
      stores: await prisma.store.count(),
      dealCategories: await prisma.dealCategoryMaster.count(),
      dealTypes: await prisma.dealTypeMaster.count(),
      deals: await prisma.deal.count(),
      achievements: await prisma.achievement.count(),
      nudges: await prisma.nudge.count(),
      events: await prisma.event.count(),
      ticketTiers: await prisma.eventTicketTier.count(),
      eventAddOns: await prisma.eventAddOn.count(),
    };
    console.log('\n📊 Database Summary:');
    console.table(counts);

    console.log('\n🔑 Test Accounts:');
    console.log('  Consumer:  alex@test.com   / Test@1234');
    console.log('  Consumer:  maria@test.com  / Test@1234');
    console.log('  Consumer:  james@test.com  / Test@1234  (Gold tier)');
    console.log('  Merchant:  merchant1@test.com / Test@1234 (The Velvet Lounge)');
    console.log('  Merchant:  merchant2@test.com / Test@1234 (Spice Route Kitchen)');
    console.log('  Merchant:  merchant3@test.com / Test@1234 (Neon Nights Club)');
    console.log('  Merchant:  merchant4@test.com / Test@1234 (Sunset Taco Co.)');
    console.log('  Admin:     admin@test.com  / Test@1234');
    console.log('  Organizer: organizer@test.com / Test@1234');
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
