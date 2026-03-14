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
  MenuDealType,
  ServiceStatus,
  TableStatus,
  VenueRewardType,
  VenueRewardStatus,
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
      const updated = await prisma.merchant.update({
        where: { id: existing.id },
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
        },
      });
      createdMerchants.push({ id: updated.id, ownerId: updated.ownerId, businessName: updated.businessName, latitude: updated.latitude, longitude: updated.longitude });
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

  const categoryImageFallbacks: Record<string, string[]> = {
    'Food': [
      'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=900&q=80',
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=900&q=80',
      'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=900&q=80',
    ],
    'Entertainment': [
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=900&q=80',
      'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=900&q=80',
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900&q=80',
    ],
    'Nightlife': [
      'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&q=80',
      'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=900&q=80',
      'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&q=80',
    ],
    'Health & Fitness': [
      'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=900&q=80',
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900&q=80',
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=900&q=80',
    ],
    'Beauty & Spa': [
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=900&q=80',
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=900&q=80',
      'https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=900&q=80',
    ],
  };

  const enrichDealImages = (imageUrls: string[] | undefined, categoryName: string): string[] => {
    const base = (imageUrls || []).filter(Boolean);
    const fallbacks = categoryImageFallbacks[categoryName] || categoryImageFallbacks['Food'];
    const merged = [...new Set([...base, ...fallbacks])];
    return merged.slice(0, 5);
  };

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
    {
      merchantBiz: 'Spice Route Kitchen',
      title: 'Wellness Bowl + Fresh Juice Combo',
      description: 'Balanced protein bowl paired with a fresh-pressed juice at 35% off during lunch.',
      categoryName: 'Health & Fitness',
      dealTypeName: 'Standard',
      discountPercentage: 35,
      startTime: inDays(-2),
      endTime: inDays(60),
      redemptionInstructions: 'Show this deal at the counter between 11 AM and 3 PM.',
      imageUrls: ['https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600'],
    },
    {
      merchantBiz: 'The Velvet Lounge',
      title: 'Beauty & Spa Night Package',
      description: 'Pre-event glam package with partner studio: makeup touch-up and styling at 30% off.',
      categoryName: 'Beauty & Spa',
      dealTypeName: 'Standard',
      discountPercentage: 30,
      startTime: inDays(-1),
      endTime: inDays(75),
      redemptionInstructions: 'Book through the host desk and mention this package.',
      imageUrls: ['https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600'],
    },
  ];

  let count = 0;
  for (const d of dealsData) {
    const merchant = merchants.find((m) => m.businessName === d.merchantBiz);
    if (!merchant) continue;

    const existing = await prisma.deal.findFirst({
      where: { merchantId: merchant.id, title: d.title },
    });
    if (existing) {
      const enrichedImageUrls = enrichDealImages(d.imageUrls, d.categoryName);
      await prisma.deal.update({
        where: { id: existing.id },
        data: {
          description: d.description,
          categoryId: catId(d.categoryName),
          dealTypeId: typeId(d.dealTypeName),
          discountPercentage: d.discountPercentage,
          discountAmount: d.discountAmount,
          startTime: d.startTime,
          endTime: d.endTime,
          redemptionInstructions: d.redemptionInstructions,
          imageUrls: enrichedImageUrls,
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
      continue;
    }

    const enrichedImageUrls = enrichDealImages(d.imageUrls, d.categoryName);

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
        imageUrls: enrichedImageUrls,
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

// ─── 7b. Services ───────────────────────────────────────────────

async function seedServices(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n🛠️  Seeding services...');

  const servicesData: Array<{
    merchantBiz: string;
    title: string;
    description: string;
    shortDescription: string;
    serviceType: string;
    category: string;
    durationMinutes: number;
    coverImageUrl: string;
    imageGallery: string[];
    tags: string[];
    requiresApproval?: boolean;
    advanceBookingDays?: number;
    cancellationHours?: number;
    maxBookingsPerDay?: number;
    status?: ServiceStatus;
    tiers: Array<{
      name: string;
      description: string;
      price: number;
      durationMinutes: number;
      totalSlots?: number;
      maxPerUser?: number;
      isActive?: boolean;
    }>;
    addOns: Array<{
      name: string;
      description: string;
      price: number;
      isOptional?: boolean;
      isActive?: boolean;
    }>;
  }> = [
    {
      merchantBiz: 'The Velvet Lounge',
      title: 'Craft Cocktail Masterclass',
      description:
        'Hands-on mixology workshop led by our head bartender. Learn stirring, shaking, garnish pairing, and spirit balancing techniques in a premium lounge setting.',
      shortDescription: '90-minute mixology workshop with tastings.',
      serviceType: 'MIXOLOGY',
      category: 'Nightlife',
      durationMinutes: 90,
      coverImageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=1200&q=80',
      imageGallery: [
        'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=1200&q=80',
        'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=1200&q=80',
        'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=1200&q=80',
      ],
      tags: ['cocktails', 'experience', 'nightlife'],
      requiresApproval: false,
      advanceBookingDays: 30,
      cancellationHours: 12,
      maxBookingsPerDay: 16,
      status: ServiceStatus.PUBLISHED,
      tiers: [
        {
          name: 'Standard Seat',
          description: 'Shared station, all tools included.',
          price: 39,
          durationMinutes: 90,
          totalSlots: 20,
          maxPerUser: 4,
        },
        {
          name: 'VIP Tasting Seat',
          description: 'Premium spirits + extended tasting flight.',
          price: 69,
          durationMinutes: 110,
          totalSlots: 8,
          maxPerUser: 2,
        },
      ],
      addOns: [
        { name: 'Take-home Syrup Kit', description: 'House-made syrup sampler.', price: 12, isOptional: true },
        { name: 'Polaroid Memory Pack', description: 'Instant photo set from the class.', price: 8, isOptional: true },
      ],
    },
    {
      merchantBiz: 'Spice Route Kitchen',
      title: 'Chef’s Table Tasting Experience',
      description:
        'A guided 5-course tasting with chef commentary, spice pairing notes, and curated plating stories from regional Indian cuisines.',
      shortDescription: '5-course chef-led tasting journey.',
      serviceType: 'DINING_EXPERIENCE',
      category: 'Food & Beverage',
      durationMinutes: 120,
      coverImageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80',
      imageGallery: [
        'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80',
        'https://images.unsplash.com/photo-1601050690117-94f5f6fa3bd4?w=1200&q=80',
        'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=1200&q=80',
      ],
      tags: ['chef-table', 'tasting', 'fine-dining'],
      requiresApproval: true,
      advanceBookingDays: 45,
      cancellationHours: 24,
      maxBookingsPerDay: 10,
      status: ServiceStatus.PUBLISHED,
      tiers: [
        {
          name: 'Counter Seat',
          description: 'Interactive chef counter seat.',
          price: 59,
          durationMinutes: 120,
          totalSlots: 14,
          maxPerUser: 4,
        },
        {
          name: 'Private Pairing Seat',
          description: 'Includes non-alcoholic pairing flight.',
          price: 89,
          durationMinutes: 130,
          totalSlots: 6,
          maxPerUser: 2,
        },
      ],
      addOns: [
        { name: 'Dessert Upgrade', description: 'Signature trio dessert plate.', price: 11 },
        { name: 'Spice Box Gift', description: 'Chef curated spice sampler.', price: 15 },
      ],
    },
    {
      merchantBiz: 'Neon Nights Club',
      title: 'VIP Table Setup & Host Service',
      description:
        'Pre-booked VIP zone with dedicated host, priority entry lane, and table styling for birthdays and group celebrations.',
      shortDescription: 'Priority-entry VIP table with host support.',
      serviceType: 'VIP_HOSTING',
      category: 'Entertainment',
      durationMinutes: 180,
      coverImageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1200&q=80',
      imageGallery: [
        'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1200&q=80',
        'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200&q=80',
        'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80',
      ],
      tags: ['vip', 'club', 'hosting'],
      requiresApproval: true,
      advanceBookingDays: 21,
      cancellationHours: 24,
      maxBookingsPerDay: 8,
      status: ServiceStatus.PUBLISHED,
      tiers: [
        {
          name: 'Silver VIP',
          description: 'Entry + premium table zone.',
          price: 129,
          durationMinutes: 180,
          totalSlots: 10,
          maxPerUser: 2,
        },
        {
          name: 'Gold VIP',
          description: 'Front row zone + dedicated host.',
          price: 219,
          durationMinutes: 210,
          totalSlots: 6,
          maxPerUser: 2,
        },
      ],
      addOns: [
        { name: 'Birthday Sparkler Pack', description: 'Table celebration add-on.', price: 25 },
        { name: 'Priority Photo Booth', description: 'Unlimited express queue access.', price: 18 },
      ],
    },
    {
      merchantBiz: 'Sunset Taco Co.',
      title: 'Taco Making Workshop',
      description:
        'Learn marination, tortilla prep, and salsa balancing with our kitchen team. Includes live demos and a build-your-own taco finale.',
      shortDescription: 'Interactive taco workshop + tasting.',
      serviceType: 'COOKING_CLASS',
      category: 'Food & Beverage',
      durationMinutes: 75,
      coverImageUrl: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=1200&q=80',
      imageGallery: [
        'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=1200&q=80',
        'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=1200&q=80',
        'https://images.unsplash.com/photo-1618040996337-56904b7850b9?w=1200&q=80',
      ],
      tags: ['tacos', 'class', 'family-friendly'],
      requiresApproval: false,
      advanceBookingDays: 20,
      cancellationHours: 8,
      maxBookingsPerDay: 24,
      status: ServiceStatus.PUBLISHED,
      tiers: [
        {
          name: 'Solo Apron Seat',
          description: 'Single participant workstation.',
          price: 29,
          durationMinutes: 75,
          totalSlots: 18,
          maxPerUser: 4,
        },
        {
          name: 'Duo Date Seat',
          description: 'Two-person workstation with shared platter.',
          price: 49,
          durationMinutes: 85,
          totalSlots: 10,
          maxPerUser: 2,
        },
      ],
      addOns: [
        { name: 'Guac Upgrade', description: 'Fresh table-side guacamole.', price: 7 },
        { name: 'Margarita Pairing', description: 'Classic or spicy margarita.', price: 9 },
      ],
    },
  ];

  let serviceCount = 0;
  let tierCount = 0;
  let addOnCount = 0;

  for (const entry of servicesData) {
    const merchant = merchants.find((m) => m.businessName === entry.merchantBiz);
    if (!merchant) continue;

    const existing = await prisma.service.findFirst({
      where: { merchantId: merchant.id, title: entry.title },
    });

    const service = existing
      ? await prisma.service.update({
          where: { id: existing.id },
          data: {
            description: entry.description,
            shortDescription: entry.shortDescription,
            serviceType: entry.serviceType,
            status: entry.status ?? ServiceStatus.PUBLISHED,
            category: entry.category,
            durationMinutes: entry.durationMinutes,
            coverImageUrl: entry.coverImageUrl,
            imageGallery: entry.imageGallery,
            tags: entry.tags,
            requiresApproval: entry.requiresApproval ?? false,
            advanceBookingDays: entry.advanceBookingDays ?? 30,
            cancellationHours: entry.cancellationHours ?? 24,
            maxBookingsPerDay: entry.maxBookingsPerDay ?? null,
            publishedAt: new Date(),
          },
        })
      : await prisma.service.create({
          data: {
            merchantId: merchant.id,
            title: entry.title,
            description: entry.description,
            shortDescription: entry.shortDescription,
            serviceType: entry.serviceType,
            status: entry.status ?? ServiceStatus.PUBLISHED,
            category: entry.category,
            durationMinutes: entry.durationMinutes,
            coverImageUrl: entry.coverImageUrl,
            imageGallery: entry.imageGallery,
            tags: entry.tags,
            requiresApproval: entry.requiresApproval ?? false,
            advanceBookingDays: entry.advanceBookingDays ?? 30,
            cancellationHours: entry.cancellationHours ?? 24,
            maxBookingsPerDay: entry.maxBookingsPerDay ?? null,
            publishedAt: new Date(),
          },
        });

    serviceCount++;

    for (const tier of entry.tiers) {
      const existingTier = await prisma.servicePricingTier.findFirst({
        where: { serviceId: service.id, name: tier.name },
      });

      if (existingTier) {
        await prisma.servicePricingTier.update({
          where: { id: existingTier.id },
          data: {
            description: tier.description,
            price: tier.price,
            durationMinutes: tier.durationMinutes,
            totalSlots: tier.totalSlots ?? null,
            maxPerUser: tier.maxPerUser ?? 1,
            isActive: tier.isActive ?? true,
          },
        });
      } else {
        await prisma.servicePricingTier.create({
          data: {
            serviceId: service.id,
            name: tier.name,
            description: tier.description,
            price: tier.price,
            durationMinutes: tier.durationMinutes,
            totalSlots: tier.totalSlots ?? null,
            maxPerUser: tier.maxPerUser ?? 1,
            isActive: tier.isActive ?? true,
          },
        });
      }
      tierCount++;
    }

    for (const addOn of entry.addOns) {
      const existingAddOn = await prisma.serviceAddOn.findFirst({
        where: { serviceId: service.id, name: addOn.name },
      });

      if (existingAddOn) {
        await prisma.serviceAddOn.update({
          where: { id: existingAddOn.id },
          data: {
            description: addOn.description,
            price: addOn.price,
            isOptional: addOn.isOptional ?? true,
            isActive: addOn.isActive ?? true,
          },
        });
      } else {
        await prisma.serviceAddOn.create({
          data: {
            serviceId: service.id,
            name: addOn.name,
            description: addOn.description,
            price: addOn.price,
            isOptional: addOn.isOptional ?? true,
            isActive: addOn.isActive ?? true,
          },
        });
      }
      addOnCount++;
    }
  }

  console.log(`  ✅ ${serviceCount} services ready`);
  console.log(`     └─ ${tierCount} service tier entries ready`);
  console.log(`     └─ ${addOnCount} service add-on entries ready`);
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

// ─── 10. Menu Items ─────────────────────────────────────────────

async function seedMenuItems(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n🍽️  Seeding menu items...');

  const menuData: Record<string, { name: string; description: string; price: number; category: string; happyHourPrice?: number; isHappyHour?: boolean; dealType?: MenuDealType }[]> = {
    'The Velvet Lounge': [
      { name: 'Espresso Martini', description: 'Vodka, fresh espresso, Kahlúa, vanilla syrup', price: 16, category: 'Cocktails', happyHourPrice: 10, isHappyHour: true, dealType: MenuDealType.HAPPY_HOUR_BOUNTY },
      { name: 'Old Fashioned', description: 'Bourbon, bitters, orange peel, luxardo cherry', price: 18, category: 'Cocktails', happyHourPrice: 12, isHappyHour: true },
      { name: 'Smoky Negroni', description: 'Mezcal, Campari, sweet vermouth, smoked rosemary', price: 17, category: 'Cocktails' },
      { name: 'Truffle Fries', description: 'Parmesan, truffle oil, fresh herbs', price: 14, category: 'Small Plates' },
      { name: 'Wagyu Sliders', description: 'Three wagyu beef sliders with aioli and pickled onion', price: 22, category: 'Small Plates' },
      { name: 'Charcuterie Board', description: 'Imported cheeses, cured meats, honeycomb, artisan crackers', price: 28, category: 'Shared Plates' },
      { name: 'Champagne Flight', description: 'Three 3oz pours of premium champagne', price: 32, category: 'Wine & Bubbles', happyHourPrice: 20, isHappyHour: true },
      { name: 'Red Wine Glass', description: 'Rotating selection of premium red wines', price: 15, category: 'Wine & Bubbles' },
    ],
    'Spice Route Kitchen': [
      { name: 'Butter Chicken', description: 'Tender chicken in rich tomato-cream sauce, served with basmati', price: 19, category: 'Mains' },
      { name: 'Lamb Rogan Josh', description: 'Slow-braised lamb in Kashmiri spices', price: 23, category: 'Mains' },
      { name: 'Paneer Tikka Masala', description: 'Grilled paneer in creamy spiced sauce', price: 17, category: 'Mains' },
      { name: 'Samosa Platter', description: 'Six crispy samosas with three chutneys', price: 11, category: 'Starters', happyHourPrice: 7, isHappyHour: true },
      { name: 'Garlic Naan', description: 'Wood-fired naan with roasted garlic and butter', price: 5, category: 'Breads' },
      { name: 'Mango Lassi', description: 'Creamy mango yogurt drink', price: 6, category: 'Drinks' },
      { name: 'Masala Chai', description: 'Authentic spiced tea with cardamom and ginger', price: 4, category: 'Drinks' },
      { name: 'Gulab Jamun', description: 'Three warm milk dumplings in rose-cardamom syrup', price: 8, category: 'Desserts' },
      { name: 'Thali Platter', description: 'Chef\'s selection: appetizer, two curries, rice, naan, raita, dessert', price: 26, category: 'Specials', happyHourPrice: 13, isHappyHour: true, dealType: MenuDealType.HAPPY_HOUR_MID_DAY },
    ],
    'Neon Nights Club': [
      { name: 'Neon Glow Shot', description: 'UV-reactive vodka shot with blue curaçao', price: 8, category: 'Shots', happyHourPrice: 5, isHappyHour: true },
      { name: 'DJ\'s Punch Bowl', description: 'Serves 4 — rum, passion fruit, pineapple, grenadine', price: 45, category: 'Shared Drinks' },
      { name: 'Vodka Red Bull', description: 'Premium vodka with Red Bull — classic club fuel', price: 14, category: 'Cocktails', happyHourPrice: 9, isHappyHour: true },
      { name: 'Bottle Service (Grey Goose)', description: '750ml Grey Goose with mixers and sparklers', price: 350, category: 'Bottle Service' },
      { name: 'Bottle Service (Dom Pérignon)', description: '750ml Dom Pérignon with sparklers', price: 500, category: 'Bottle Service' },
      { name: 'Loaded Nachos', description: 'Nachos with cheese, jalapeños, guac, sour cream', price: 13, category: 'Late Night Bites', happyHourPrice: 8, isHappyHour: true, dealType: MenuDealType.HAPPY_HOUR_LATE_NIGHT },
      { name: 'Chicken Wings Basket', description: 'Buffalo or BBQ wings, served with ranch', price: 14, category: 'Late Night Bites' },
    ],
    'Sunset Taco Co.': [
      { name: 'Street Taco (Carne Asada)', description: 'Grilled steak, onion, cilantro, lime on corn tortilla', price: 4, category: 'Tacos' },
      { name: 'Street Taco (Al Pastor)', description: 'Marinated pork, pineapple, onion, cilantro', price: 4, category: 'Tacos' },
      { name: 'Street Taco (Carnitas)', description: 'Slow-braised pork, pickled onion, salsa verde', price: 4, category: 'Tacos' },
      { name: 'Street Taco (Veggie)', description: 'Grilled peppers, squash, black beans, queso fresco', price: 3.5, category: 'Tacos' },
      { name: 'Burrito Grande', description: 'Choose your protein — rice, beans, cheese, pico, guac', price: 12, category: 'Burritos' },
      { name: 'Queso Fundido', description: 'Melted Oaxaca cheese with chorizo, served with chips', price: 10, category: 'Starters', happyHourPrice: 6, isHappyHour: true },
      { name: 'Elotes', description: 'Mexican street corn with mayo, cotija, tajín', price: 6, category: 'Sides' },
      { name: 'Horchata', description: 'Traditional rice and cinnamon drink', price: 4, category: 'Drinks' },
      { name: 'Margarita (Classic)', description: 'Tequila, fresh lime, agave, salt rim', price: 11, category: 'Cocktails', happyHourPrice: 7, isHappyHour: true },
      { name: 'Mexican Beer Bucket', description: '5 bottles: Corona, Modelo, Pacifico mix', price: 22, category: 'Beer', happyHourPrice: 15, isHappyHour: true },
    ],
  };

  const menuCategoryImageLibrary: Record<string, string[]> = {
    Cocktails: [
      'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&q=80',
      'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=900&q=80',
      'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=900&q=80',
    ],
    'Wine & Bubbles': [
      'https://images.unsplash.com/photo-1474722883778-792e7990302f?w=900&q=80',
      'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80',
      'https://images.unsplash.com/photo-1470158499416-75be9aa0c4db?w=900&q=80',
    ],
    'Small Plates': [
      'https://images.unsplash.com/photo-1544025162-d76694265947?w=900&q=80',
      'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=900&q=80',
      'https://images.unsplash.com/photo-1541014741259-de529411b96a?w=900&q=80',
    ],
    'Shared Plates': [
      'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=900&q=80',
      'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=900&q=80',
      'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=900&q=80',
    ],
    Mains: [
      'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=900&q=80',
      'https://images.unsplash.com/photo-1601050690117-94f5f6fa3bd4?w=900&q=80',
      'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=900&q=80',
    ],
    Starters: [
      'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=80',
      'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=900&q=80',
      'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=900&q=80',
    ],
    Breads: [
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=900&q=80',
      'https://images.unsplash.com/photo-1608198093002-ad4e005484ec?w=900&q=80',
      'https://images.unsplash.com/photo-1573140401552-3fab0b24306f?w=900&q=80',
    ],
    Drinks: [
      'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=900&q=80',
      'https://images.unsplash.com/photo-1560508179-b2c9a3f8e92b?w=900&q=80',
      'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=900&q=80',
    ],
    Desserts: [
      'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=900&q=80',
      'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=900&q=80',
      'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=900&q=80',
    ],
    Specials: [
      'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=900&q=80',
      'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=900&q=80',
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900&q=80',
    ],
    Shots: [
      'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=900&q=80',
      'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=900&q=80',
      'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&q=80',
    ],
    'Shared Drinks': [
      'https://images.unsplash.com/photo-1462887749044-b47cb05b83b8?w=900&q=80',
      'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=900&q=80',
      'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&q=80',
    ],
    'Bottle Service': [
      'https://images.unsplash.com/photo-1547595628-c61a29f496f0?w=900&q=80',
      'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80',
      'https://images.unsplash.com/photo-1497534446932-c925b458314e?w=900&q=80',
    ],
    'Late Night Bites': [
      'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=900&q=80',
      'https://images.unsplash.com/photo-1608039755401-742074f0548d?w=900&q=80',
      'https://images.unsplash.com/photo-1565299507177-b0ac66763828?w=900&q=80',
    ],
    Tacos: [
      'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=900&q=80',
      'https://images.unsplash.com/photo-1618040996337-56904b7850b9?w=900&q=80',
      'https://images.unsplash.com/photo-1624300629298-e9de39c13be5?w=900&q=80',
    ],
    Burritos: [
      'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=900&q=80',
      'https://images.unsplash.com/photo-1534352956036-cd81e27dd615?w=900&q=80',
      'https://images.unsplash.com/photo-1604467715878-83e57e8bc129?w=900&q=80',
    ],
    Sides: [
      'https://images.unsplash.com/photo-1592417817098-8fd3d9eb14a5?w=900&q=80',
      'https://images.unsplash.com/photo-1525755662778-989d0524087e?w=900&q=80',
      'https://images.unsplash.com/photo-1562967914-608f82629710?w=900&q=80',
    ],
    Beer: [
      'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80',
      'https://images.unsplash.com/photo-1532634922-8fe0b757fb13?w=900&q=80',
      'https://images.unsplash.com/photo-1527661591475-527312dd65f5?w=900&q=80',
    ],
  };

  const defaultMenuImages = [
    'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=900&q=80',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=900&q=80',
    'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=900&q=80',
  ];

  const hashSeed = (input: string) =>
    input.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  const resolveMenuImages = (itemName: string, category: string) => {
    const pool = menuCategoryImageLibrary[category] || defaultMenuImages;
    const seed = hashSeed(`${itemName}-${category}`);
    const ordered = pool.map((_, idx) => pool[(idx + seed) % pool.length]);
    const unique = [...new Set(ordered)];
    return {
      imageUrl: unique[0],
      imageUrls: unique.slice(0, 4),
    };
  };

  let total = 0;
  for (const [bizName, items] of Object.entries(menuData)) {
    const merchant = merchants.find((m) => m.businessName === bizName);
    if (!merchant) continue;

    for (const item of items) {
      const { imageUrl, imageUrls } = resolveMenuImages(item.name, item.category);
      const existing = await prisma.menuItem.findFirst({
        where: { merchantId: merchant.id, name: item.name },
      });
      if (existing) {
        await prisma.menuItem.update({
          where: { id: existing.id },
          data: {
            description: item.description,
            price: item.price,
            category: item.category,
            happyHourPrice: item.happyHourPrice ?? null,
            isHappyHour: item.isHappyHour ?? false,
            dealType: item.dealType ?? MenuDealType.STANDARD,
            imageUrl,
            imageUrls,
          },
        });
        total++;
        continue;
      }

      await prisma.menuItem.create({
        data: {
          merchantId: merchant.id,
          name: item.name,
          description: item.description,
          price: item.price,
          category: item.category,
          imageUrl,
          imageUrls,
          happyHourPrice: item.happyHourPrice ?? null,
          isHappyHour: item.isHappyHour ?? false,
          dealType: item.dealType ?? MenuDealType.STANDARD,
        },
      });
      total++;
    }
  }
  console.log(`  ✅ ${total} menu items ready`);
}

// ─── 10b. Deal ↔ Menu Item links ────────────────────────────────

async function seedDealMenuItems(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n🔗 Linking deals to menu items...');

  let linked = 0;

  for (const merchant of merchants) {
    // Get all deals for this merchant
    const deals = await prisma.deal.findMany({
      where: { merchantId: merchant.id },
      select: { id: true, title: true },
    });

    // Get all menu items for this merchant
    const menuItems = await prisma.menuItem.findMany({
      where: { merchantId: merchant.id },
      select: { id: true },
    });

    if (deals.length === 0 || menuItems.length === 0) continue;

    for (const deal of deals) {
      // Check if this deal already has DealMenuItem records
      const existingCount = await prisma.dealMenuItem.count({
        where: { dealId: deal.id },
      });
      if (existingCount > 0) {
        linked += existingCount;
        continue;
      }

      // Link ALL of the merchant's menu items to the deal
      for (const mi of menuItems) {
        try {
          await prisma.dealMenuItem.create({
            data: {
              dealId: deal.id,
              menuItemId: mi.id,
              useGlobalDiscount: true,
            },
          });
          linked++;
        } catch (e: any) {
          // Skip duplicates (unique constraint)
          if (e?.code !== 'P2002') throw e;
        }
      }
    }
  }

  console.log(`  ✅ ${linked} deal–menu links ready`);
}

// ─── 11. Menu Collections ───────────────────────────────────────

async function seedMenuCollections(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n📋 Seeding menu collections...');

  const collectionsData: Record<string, { name: string; description: string; itemNames: string[] }[]> = {
    'The Velvet Lounge': [
      { name: 'Happy Hour Specials', description: 'Discounted cocktails 5–8 PM daily', itemNames: ['Espresso Martini', 'Old Fashioned', 'Champagne Flight'] },
      { name: 'Date Night', description: 'Perfect pairing for two', itemNames: ['Charcuterie Board', 'Smoky Negroni', 'Red Wine Glass'] },
    ],
    'Spice Route Kitchen': [
      { name: 'Lunch Express', description: 'Quick weekday lunch options', itemNames: ['Thali Platter', 'Garlic Naan', 'Mango Lassi'] },
      { name: 'Vegetarian Favorites', description: 'Our best meat-free dishes', itemNames: ['Paneer Tikka Masala', 'Samosa Platter', 'Garlic Naan', 'Gulab Jamun'] },
    ],
    'Sunset Taco Co.': [
      { name: 'Taco Tuesday Picks', description: 'Our most popular Tuesday tacos', itemNames: ['Street Taco (Carne Asada)', 'Street Taco (Al Pastor)', 'Street Taco (Carnitas)', 'Street Taco (Veggie)'] },
      { name: 'Happy Hour Combos', description: 'Drinks + bites at special prices', itemNames: ['Margarita (Classic)', 'Mexican Beer Bucket', 'Queso Fundido'] },
    ],
  };

  let total = 0;
  for (const [bizName, collections] of Object.entries(collectionsData)) {
    const merchant = merchants.find((m) => m.businessName === bizName);
    if (!merchant) continue;

    for (const col of collections) {
      const existing = await prisma.menuCollection.findFirst({
        where: { merchantId: merchant.id, name: col.name },
      });
      if (existing) { total++; continue; }

      const collection = await prisma.menuCollection.create({
        data: { merchantId: merchant.id, name: col.name, description: col.description, isActive: true },
      });

      const menuItems = await prisma.menuItem.findMany({
        where: { merchantId: merchant.id, name: { in: col.itemNames } },
      });

      for (let i = 0; i < menuItems.length; i++) {
        await prisma.menuCollectionItem.create({
          data: { collectionId: collection.id, menuItemId: menuItems[i].id, sortOrder: i + 1 },
        });
      }
      total++;
    }
  }
  console.log(`  ✅ ${total} menu collections ready`);
}

// ─── 12. Tables & Booking Settings ──────────────────────────────

async function seedTablesAndBookings(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n🪑 Seeding tables & booking settings...');

  const tablesData: Record<string, { name: string; capacity: number; features: string[] }[]> = {
    'The Velvet Lounge': [
      { name: 'Bar Seat 1-4', capacity: 4, features: ['bar_seating'] },
      { name: 'Booth A', capacity: 4, features: ['booth', 'intimate'] },
      { name: 'Booth B', capacity: 6, features: ['booth', 'group'] },
      { name: 'Rooftop Table 1', capacity: 4, features: ['rooftop', 'view'] },
      { name: 'Rooftop Table 2', capacity: 6, features: ['rooftop', 'view'] },
      { name: 'VIP Lounge', capacity: 8, features: ['vip', 'private', 'bottle_service'] },
    ],
    'Spice Route Kitchen': [
      { name: 'Window Table 1', capacity: 2, features: ['window', 'romantic'] },
      { name: 'Window Table 2', capacity: 2, features: ['window', 'romantic'] },
      { name: 'Main Floor 1', capacity: 4, features: ['main_floor'] },
      { name: 'Main Floor 2', capacity: 4, features: ['main_floor'] },
      { name: 'Large Party Table', capacity: 10, features: ['group', 'main_floor'] },
      { name: 'Private Dining Room', capacity: 12, features: ['private', 'group', 'events'] },
    ],
    'Sunset Taco Co.': [
      { name: 'Patio Table 1', capacity: 4, features: ['patio', 'outdoor'] },
      { name: 'Patio Table 2', capacity: 4, features: ['patio', 'outdoor'] },
      { name: 'Patio Table 3', capacity: 6, features: ['patio', 'outdoor', 'group'] },
      { name: 'Indoor Booth', capacity: 4, features: ['booth', 'indoor'] },
      { name: 'Bar Counter', capacity: 6, features: ['bar_seating', 'casual'] },
    ],
  };

  let tableCount = 0;
  for (const [bizName, tables] of Object.entries(tablesData)) {
    const merchant = merchants.find((m) => m.businessName === bizName);
    if (!merchant) continue;

    // Booking settings
    const existingSettings = await prisma.bookingSettings.findUnique({ where: { merchantId: merchant.id } });
    if (!existingSettings) {
      await prisma.bookingSettings.create({
        data: {
          merchantId: merchant.id,
          advanceBookingDays: 30,
          minPartySize: 1,
          maxPartySize: bizName === 'Spice Route Kitchen' ? 12 : 8,
          bookingDuration: bizName === 'The Velvet Lounge' ? 150 : 90,
          requiresConfirmation: true,
          autoConfirm: bizName === 'Sunset Taco Co.',
          cancellationHours: 2,
          sendReminders: true,
          reminderHours: 2,
        },
      });
    }

    for (const t of tables) {
      const existing = await prisma.table.findFirst({
        where: { merchantId: merchant.id, name: t.name },
      });
      if (existing) { tableCount++; continue; }

      await prisma.table.create({
        data: {
          merchantId: merchant.id,
          name: t.name,
          capacity: t.capacity,
          features: t.features,
          status: TableStatus.AVAILABLE,
        },
      });
      tableCount++;
    }
  }
  console.log(`  ✅ ${tableCount} tables + booking settings ready`);
}

// ─── 13. Time Slots ─────────────────────────────────────────────

async function seedTimeSlots(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n🕐 Seeding time slots...');

  const slotsData: Record<string, { dayOfWeek: number; startTime: string; endTime: string; duration: number; maxBookings: number }[]> = {
    'The Velvet Lounge': [
      // Tue–Sat evenings (dayOfWeek 2–6)
      ...([2, 3, 4, 5, 6] as number[]).flatMap((day) => [
        { dayOfWeek: day, startTime: '17:00', endTime: '19:00', duration: 120, maxBookings: 4 },
        { dayOfWeek: day, startTime: '19:00', endTime: '21:00', duration: 120, maxBookings: 4 },
        { dayOfWeek: day, startTime: '21:00', endTime: '23:00', duration: 120, maxBookings: 3 },
      ]),
    ],
    'Spice Route Kitchen': [
      // Mon–Sat lunch + dinner
      ...([1, 2, 3, 4, 5, 6] as number[]).flatMap((day) => [
        { dayOfWeek: day, startTime: '11:00', endTime: '12:30', duration: 90, maxBookings: 5 },
        { dayOfWeek: day, startTime: '12:30', endTime: '14:00', duration: 90, maxBookings: 5 },
        { dayOfWeek: day, startTime: '18:00', endTime: '19:30', duration: 90, maxBookings: 5 },
        { dayOfWeek: day, startTime: '19:30', endTime: '21:00', duration: 90, maxBookings: 5 },
        { dayOfWeek: day, startTime: '21:00', endTime: '22:30', duration: 90, maxBookings: 3 },
      ]),
    ],
    'Sunset Taco Co.': [
      // Every day lunch + dinner
      ...([0, 1, 2, 3, 4, 5, 6] as number[]).flatMap((day) => [
        { dayOfWeek: day, startTime: '11:00', endTime: '13:00', duration: 60, maxBookings: 4 },
        { dayOfWeek: day, startTime: '17:00', endTime: '19:00', duration: 60, maxBookings: 4 },
        { dayOfWeek: day, startTime: '19:00', endTime: '21:00', duration: 60, maxBookings: 4 },
      ]),
    ],
  };

  let total = 0;
  for (const [bizName, slots] of Object.entries(slotsData)) {
    const merchant = merchants.find((m) => m.businessName === bizName);
    if (!merchant) continue;

    for (const s of slots) {
      const existing = await prisma.timeSlot.findFirst({
        where: { merchantId: merchant.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime },
      });
      if (existing) { total++; continue; }

      await prisma.timeSlot.create({
        data: { merchantId: merchant.id, ...s, isActive: true },
      });
      total++;
    }
  }
  console.log(`  ✅ ${total} time slots ready`);
}

// ─── 14. Merchant Loyalty Programs ──────────────────────────────

async function seedLoyaltyPrograms(
  merchants: { id: number; businessName: string }[],
) {
  console.log('\n💎 Seeding loyalty programs...');

  const programsData: Record<string, { pointsPerDollar: number; minimumPurchase: number; minimumRedemption: number; redemptionValue: number; allowCombineWithDeals: boolean }> = {
    'The Velvet Lounge': { pointsPerDollar: 0.5, minimumPurchase: 10, minimumRedemption: 50, redemptionValue: 10, allowCombineWithDeals: false },
    'Spice Route Kitchen': { pointsPerDollar: 0.4, minimumPurchase: 5, minimumRedemption: 25, redemptionValue: 5, allowCombineWithDeals: true },
    'Neon Nights Club': { pointsPerDollar: 0.3, minimumPurchase: 20, minimumRedemption: 30, redemptionValue: 8, allowCombineWithDeals: true },
    'Sunset Taco Co.': { pointsPerDollar: 0.6, minimumPurchase: 5, minimumRedemption: 20, redemptionValue: 5, allowCombineWithDeals: true },
  };

  for (const [bizName, config] of Object.entries(programsData)) {
    const merchant = merchants.find((m) => m.businessName === bizName);
    if (!merchant) continue;

    const existing = await prisma.merchantLoyaltyProgram.findUnique({ where: { merchantId: merchant.id } });
    if (existing) continue;

    await prisma.merchantLoyaltyProgram.create({
      data: {
        merchantId: merchant.id,
        isActive: true,
        ...config,
        pointExpirationDays: 365,
        earnOnDiscounted: false,
      },
    });
  }
  console.log(`  ✅ ${Object.keys(programsData).length} loyalty programs ready`);
}

// ─── 15. Loyalty Tier Config ────────────────────────────────────

async function seedLoyaltyTierConfig() {
  console.log('\n🏅 Seeding loyalty tier config...');

  const tiers = [
    { tier: LoyaltyTier.BRONZE, minSpent: 0, coinMultiplier: 1.0, discountPercentage: 0, tierColor: '#CD7F32', tierIcon: '🥉', specialPerks: { perks: ['Access to standard deals'] } },
    { tier: LoyaltyTier.SILVER, minSpent: 100, coinMultiplier: 1.25, discountPercentage: 5, tierColor: '#C0C0C0', tierIcon: '🥈', specialPerks: { perks: ['5% discount on all deals', 'Early access to flash sales'] } },
    { tier: LoyaltyTier.GOLD, minSpent: 500, coinMultiplier: 1.5, discountPercentage: 10, tierColor: '#FFD700', tierIcon: '🥇', specialPerks: { perks: ['10% discount', 'Priority booking', 'Free birthday reward'] } },
    { tier: LoyaltyTier.PLATINUM, minSpent: 1500, coinMultiplier: 2.0, discountPercentage: 15, tierColor: '#E5E4E2', tierIcon: '💎', specialPerks: { perks: ['15% discount', 'VIP events access', 'Concierge support'] } },
    { tier: LoyaltyTier.DIAMOND, minSpent: 5000, coinMultiplier: 3.0, discountPercentage: 20, tierColor: '#B9F2FF', tierIcon: '👑', specialPerks: { perks: ['20% discount', 'Exclusive deals', 'Personal account manager', 'Free upgrades'] } },
  ];

  for (const t of tiers) {
    await prisma.loyaltyTierConfig.upsert({
      where: { tier: t.tier },
      update: { minSpent: t.minSpent, coinMultiplier: t.coinMultiplier, discountPercentage: t.discountPercentage },
      create: t,
    });
  }
  console.log(`  ✅ ${tiers.length} loyalty tiers configured`);
}

// ─── 16. User Streaks ───────────────────────────────────────────

async function seedUserStreaks(
  users: { id: number; email: string; role: UserRole }[],
) {
  console.log('\n🔥 Seeding user streaks...');
  const consumers = users.filter((u) => u.role === UserRole.USER);

  const streakData = [
    { email: 'alex@test.com', currentStreak: 5, longestStreak: 12, totalCheckIns: 34, currentWeekCheckIns: 3 },
    { email: 'james@test.com', currentStreak: 15, longestStreak: 15, totalCheckIns: 78, currentWeekCheckIns: 5 },
    { email: 'maria@test.com', currentStreak: 2, longestStreak: 7, totalCheckIns: 12, currentWeekCheckIns: 2 },
    { email: 'david@test.com', currentStreak: 0, longestStreak: 4, totalCheckIns: 8, currentWeekCheckIns: 0 },
    { email: 'priya@test.com', currentStreak: 1, longestStreak: 3, totalCheckIns: 5, currentWeekCheckIns: 1 },
  ];

  for (const s of streakData) {
    const user = consumers.find((u) => u.email === s.email);
    if (!user) continue;

    const existing = await prisma.userStreak.findUnique({ where: { userId: user.id } });
    if (existing) continue;

    await prisma.userStreak.create({
      data: {
        userId: user.id,
        currentStreak: s.currentStreak,
        longestStreak: s.longestStreak,
        totalCheckIns: s.totalCheckIns,
        currentWeekCheckIns: s.currentWeekCheckIns,
        lastCheckInDate: s.currentStreak > 0 ? new Date() : new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        streakStartDate: s.currentStreak > 0 ? new Date(Date.now() - s.currentStreak * 24 * 60 * 60 * 1000) : null,
        currentDiscountPercent: Math.min(s.currentStreak * 2, 20),
      },
    });
  }
  console.log(`  ✅ ${streakData.length} user streaks ready`);
}

// ─── 17. Delivered Nudges (UserNudge) ───────────────────────────

async function seedUserNudges(
  users: { id: number; email: string; role: UserRole }[],
) {
  console.log('\n📬 Seeding delivered nudges for consumer UI testing...');
  const consumers = users.filter((u) => u.role === UserRole.USER);
  const nudges = await prisma.nudge.findMany();
  if (nudges.length === 0) { console.log('  ⏭  No nudge templates — skipping'); return; }

  let count = 0;
  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  for (const consumer of consumers.slice(0, 3)) {
    for (const nudge of nudges.slice(0, 3)) {
      const existing = await prisma.userNudge.findFirst({
        where: { userId: consumer.id, nudgeId: nudge.id },
      });
      if (existing) { count++; continue; }

      const isRecent = count % 2 === 0;
      await prisma.userNudge.create({
        data: {
          userId: consumer.id,
          nudgeId: nudge.id,
          sentAt: isRecent ? hoursAgo(1) : hoursAgo(48),
          deliveredVia: isRecent ? 'websocket' : 'email',
          delivered: true,
          opened: !isRecent,
          openedAt: !isRecent ? hoursAgo(47) : null,
          clicked: false,
          dismissed: !isRecent,
          contextData: { source: 'seed_script', testData: true },
        },
      });
      count++;
    }
  }
  console.log(`  ✅ ${count} delivered nudges seeded`);
}

// ─── 18. Venue Rewards ──────────────────────────────────────────

async function seedVenueRewards(
  merchants: { id: number; businessName: string; latitude?: number | null; longitude?: number | null }[],
) {
  console.log('\n🎯 Seeding venue rewards...');

  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

  const rewardsData = [
    {
      merchantBiz: 'The Velvet Lounge',
      title: 'Check-in Bonus: 50 Coins',
      description: 'Visit The Velvet Lounge and earn 50 bonus coins just for checking in!',
      rewardType: VenueRewardType.COINS,
      rewardAmount: 50,
      geoFenceRadiusMeters: 100,
      status: VenueRewardStatus.ACTIVE,
      startDate: now,
      endDate: inDays(60),
      maxTotalClaims: 500,
      maxClaimsPerUser: 3,
      cooldownHours: 48,
    },
    {
      merchantBiz: 'Spice Route Kitchen',
      title: '10% Off Your Next Visit',
      description: 'Check in at Spice Route and get 10% off your next meal!',
      rewardType: VenueRewardType.DISCOUNT_PERCENTAGE,
      rewardAmount: 10,
      geoFenceRadiusMeters: 150,
      status: VenueRewardStatus.ACTIVE,
      startDate: now,
      endDate: inDays(90),
      maxTotalClaims: 200,
      maxClaimsPerUser: 2,
      cooldownHours: 72,
    },
    {
      merchantBiz: 'Neon Nights Club',
      title: 'Free Glow Shot on Entry',
      description: 'Check in at Neon Nights and claim a free Neon Glow Shot at the bar!',
      rewardType: VenueRewardType.FREE_ITEM,
      rewardAmount: 8,
      geoFenceRadiusMeters: 80,
      status: VenueRewardStatus.ACTIVE,
      startDate: now,
      endDate: inDays(30),
      maxTotalClaims: 100,
      maxClaimsPerUser: 1,
      cooldownHours: 168,
    },
    {
      merchantBiz: 'Sunset Taco Co.',
      title: 'Bonus Points: Double Loyalty',
      description: 'Check in during happy hour and earn double loyalty points on your order!',
      rewardType: VenueRewardType.BONUS_POINTS,
      rewardAmount: 2,
      geoFenceRadiusMeters: 120,
      status: VenueRewardStatus.ACTIVE,
      startDate: now,
      endDate: inDays(45),
      maxTotalClaims: 300,
      maxClaimsPerUser: 5,
      cooldownHours: 24,
    },
  ];

  let count = 0;
  for (const r of rewardsData) {
    const merchant = merchants.find((m) => m.businessName === r.merchantBiz) as any;
    if (!merchant) continue;

    const existing = await prisma.venueReward.findFirst({
      where: { merchantId: merchant.id, title: r.title },
    });
    if (existing) { count++; continue; }

    // Find the store for this merchant
    const store = await prisma.store.findFirst({ where: { merchantId: merchant.id } });

    await prisma.venueReward.create({
      data: {
        merchantId: merchant.id,
        storeId: store?.id ?? null,
        title: r.title,
        description: r.description,
        rewardType: r.rewardType,
        rewardAmount: r.rewardAmount,
        geoFenceRadiusMeters: r.geoFenceRadiusMeters,
        latitude: merchant.latitude ?? null,
        longitude: merchant.longitude ?? null,
        status: r.status,
        startDate: r.startDate,
        endDate: r.endDate,
        maxTotalClaims: r.maxTotalClaims,
        maxClaimsPerUser: r.maxClaimsPerUser,
        cooldownHours: r.cooldownHours,
        requiresCheckIn: true,
        isVerifiedOnly: false,
      },
    });
    count++;
  }
  console.log(`  ✅ ${count} venue rewards ready`);
}

// ─── 19. Events + Ticket Tiers + Add-ons ────────────────────────

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

    // 7b: Services
    await seedServices(merchants);

    // 8: Gamification
    await seedGamification();

    // 9: Nudges
    await seedNudges();

    // 10: Menu Items
    await seedMenuItems(merchants);

    // 10b: Link deals ↔ menu items (DealMenuItem join records)
    await seedDealMenuItems(merchants);

    // 11: Menu Collections
    await seedMenuCollections(merchants);

    // 12: Tables & Booking Settings
    await seedTablesAndBookings(merchants);

    // 13: Time Slots
    await seedTimeSlots(merchants);

    // 14: Loyalty Programs
    await seedLoyaltyPrograms(merchants);

    // 15: Loyalty Tier Config
    await seedLoyaltyTierConfig();

    // 16: User Streaks
    await seedUserStreaks(users);

    // 17: Delivered Nudges
    await seedUserNudges(users);

    // 18: Venue Rewards (optional — table may not exist yet)
    try {
      await seedVenueRewards(merchants);
    } catch (e: any) {
      if (e?.code === 'P2021') {
        console.log('\n🎯 Skipping venue rewards — table not yet migrated');
      } else {
        throw e;
      }
    }

    // 19: Events
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
      services: await prisma.service.count(),
      servicePricingTiers: await prisma.servicePricingTier.count(),
      serviceAddOns: await prisma.serviceAddOn.count(),
      menuItems: await prisma.menuItem.count(),
      dealMenuLinks: await prisma.dealMenuItem.count(),
      menuCollections: await prisma.menuCollection.count(),
      tables: await prisma.table.count(),
      timeSlots: await prisma.timeSlot.count(),
      achievements: await prisma.achievement.count(),
      loyaltyPrograms: await prisma.merchantLoyaltyProgram.count(),
      nudges: await prisma.nudge.count(),
      deliveredNudges: await prisma.userNudge.count(),
      userStreaks: await prisma.userStreak.count(),
      venueRewards: await prisma.venueReward.count(),
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
