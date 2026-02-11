import prisma from '../src/lib/prisma';
import { EventStatus, EventType, TicketTier } from '@prisma/client';

async function seedEvents() {
  console.log('🎫 Seeding event data...\n');

  try {
    // Find a user to be the organizer – prefer a merchant owner, fall back to any user
    let organizer = await prisma.user.findFirst({
      where: { role: { in: ['MERCHANT', 'ADMIN'] } },
      select: { id: true, name: true },
    });
    if (!organizer) {
      organizer = await prisma.user.findFirst({ select: { id: true, name: true } });
    }
    if (!organizer) {
      console.error('❌ No users found. Please seed users first.');
      process.exit(1);
    }
    console.log(`  Using organizer: ${organizer.name} (ID: ${organizer.id})`);

    // Find a merchant to attach events to
    const merchant = await prisma.merchant.findFirst({
      select: { id: true, businessName: true, address: true, latitude: true, longitude: true },
    });
    if (!merchant) {
      console.warn('⚠️  No merchants found — events will not be linked to a merchant.');
    } else {
      console.log(`  Using merchant: ${merchant.businessName} (ID: ${merchant.id})`);
    }

    // Find a city
    const city = await prisma.city.findFirst({
      select: { id: true, name: true },
    });

    // ─── Event definitions ─────────────────────────────────────────
    const eventsData = [
      {
        title: 'Neon Nights: Electronics Festival',
        description:
          'Experience the ultimate electronic music festival with world-class DJs, mesmerizing light shows, and an electric atmosphere that will keep you dancing until dawn.',
        shortDescription: 'Downtown\'s biggest electronic music festival with top DJs and immersive light shows.',
        eventType: EventType.PARTY,
        status: EventStatus.PUBLISHED,
        venueName: 'Club Electro',
        venueAddress: '420 Sunset Blvd, Los Angeles, CA 90028',
        latitude: merchant?.latitude ?? 34.0928,
        longitude: merchant?.longitude ?? -118.3287,
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
        publishedAt: new Date(),
        tiers: [
          {
            name: 'Early Bird',
            description: 'Limited early bird pricing — grab them fast!',
            tier: TicketTier.EARLY_BIRD,
            price: 15.0,
            serviceFee: 2.5,
            taxRate: 0.08,
            totalQuantity: 50,
            soldQuantity: 46,
            minPerOrder: 1,
            maxPerOrder: 4,
            isActive: true,
          },
          {
            name: 'General Admission',
            description: 'Standard entry with full venue access.',
            tier: TicketTier.GENERAL_ADMISSION,
            price: 25.0,
            serviceFee: 3.0,
            taxRate: 0.08,
            totalQuantity: 300,
            soldQuantity: 65,
            minPerOrder: 1,
            maxPerOrder: 6,
            isActive: true,
          },
          {
            name: 'VIP Pass',
            description: 'Priority entry, reserved lounge, complimentary drinks.',
            tier: TicketTier.VIP,
            price: 75.0,
            serviceFee: 5.0,
            taxRate: 0.08,
            totalQuantity: 50,
            soldQuantity: 50,
            reservedQuantity: 0,
            minPerOrder: 1,
            maxPerOrder: 2,
            isActive: true,
          },
        ],
      },
      {
        title: 'Sunset Rooftop Jazz & Wine',
        description:
          'Unwind on our exclusive rooftop terrace with smooth live jazz performances, curated wine pairings from Napa Valley\'s finest vineyards, and gourmet small plates. The perfect Friday evening.',
        shortDescription: 'Live jazz, fine wine & small plates on a stunning rooftop terrace.',
        eventType: EventType.RSVP_EVENT,
        status: EventStatus.PUBLISHED,
        venueName: 'The Rooftop at Grand',
        venueAddress: '750 Grand Ave, Los Angeles, CA 90017',
        latitude: 34.0537,
        longitude: -118.2540,
        startDate: new Date('2026-03-15T18:00:00'),
        endDate: new Date('2026-03-15T22:30:00'),
        maxAttendees: 80,
        currentAttendees: 52,
        enableWaitlist: false,
        isFreeEvent: false,
        coverImageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200',
        imageGallery: [
          'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600',
          'https://images.unsplash.com/photo-1574391884720-bbc3740c59d1?w=600',
        ],
        minAge: 21,
        ageVerificationReq: true,
        tags: ['Jazz', 'Wine', 'Rooftop', 'Live Music'],
        socialProofCount: 22,
        trendingScore: 62.0,
        publishedAt: new Date(),
        tiers: [
          {
            name: 'General Admission',
            description: 'Rooftop access + 1 complimentary glass of wine.',
            tier: TicketTier.GENERAL_ADMISSION,
            price: 45.0,
            serviceFee: 4.0,
            taxRate: 0.08,
            totalQuantity: 60,
            soldQuantity: 38,
            minPerOrder: 1,
            maxPerOrder: 4,
            isActive: true,
          },
          {
            name: 'Premium Table',
            description: 'Reserved table for 2, bottle service, priority seating.',
            tier: TicketTier.PREMIUM,
            price: 120.0,
            serviceFee: 8.0,
            taxRate: 0.08,
            totalQuantity: 20,
            soldQuantity: 14,
            minPerOrder: 1,
            maxPerOrder: 2,
            isActive: true,
          },
        ],
      },
      {
        title: 'Taco & Beer Bar Crawl',
        description:
          'Hit 4 of downtown\'s best taco spots and craft beer bars in one epic crawl! Includes a taco tasting at each stop, 4 craft beer samples, a souvenir pint glass, and a guided tour.',
        shortDescription: '4-stop taco & craft beer crawl through downtown.',
        eventType: EventType.BAR_CRAWL,
        status: EventStatus.PUBLISHED,
        venueName: 'Starts at Taco Republic',
        venueAddress: '312 Main St, Los Angeles, CA 90012',
        latitude: 34.0505,
        longitude: -118.2453,
        startDate: new Date('2026-04-05T14:00:00'),
        endDate: new Date('2026-04-05T19:00:00'),
        maxAttendees: 40,
        currentAttendees: 12,
        enableWaitlist: false,
        isFreeEvent: false,
        coverImageUrl: 'https://images.unsplash.com/photo-1504544750208-dc0358e63f7f?w=1200',
        imageGallery: [
          'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600',
          'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600',
        ],
        tags: ['Bar Crawl', 'Tacos', 'Craft Beer', 'Food Tour'],
        socialProofCount: 8,
        trendingScore: 35.0,
        publishedAt: new Date(),
        tiers: [
          {
            name: 'General Admission',
            description: 'Full crawl access — tacos, beers, pint glass included.',
            tier: TicketTier.GENERAL_ADMISSION,
            price: 35.0,
            serviceFee: 3.0,
            taxRate: 0.08,
            totalQuantity: 40,
            soldQuantity: 12,
            minPerOrder: 1,
            maxPerOrder: 6,
            isActive: true,
          },
        ],
      },
      {
        title: 'Community Yoga in the Park',
        description:
          'Start your weekend right with a free outdoor yoga session led by certified instructor Mia Chen. All skill levels welcome. Mats provided on a first-come, first-served basis.',
        shortDescription: 'Free community yoga — all levels welcome.',
        eventType: EventType.RSVP_EVENT,
        status: EventStatus.PUBLISHED,
        venueName: 'Echo Park Lake',
        venueAddress: '751 Echo Park Ave, Los Angeles, CA 90026',
        latitude: 34.0781,
        longitude: -118.2606,
        startDate: new Date('2026-03-08T08:00:00'),
        endDate: new Date('2026-03-08T09:30:00'),
        maxAttendees: 100,
        currentAttendees: 41,
        enableWaitlist: false,
        isFreeEvent: true,
        coverImageUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1200',
        tags: ['Yoga', 'Free', 'Community', 'Wellness'],
        socialProofCount: 41,
        trendingScore: 55.0,
        publishedAt: new Date(),
        tiers: [
          {
            name: 'Free RSVP',
            description: 'Reserve your spot — it\'s completely free!',
            tier: TicketTier.GENERAL_ADMISSION,
            price: 0,
            totalQuantity: 100,
            soldQuantity: 41,
            minPerOrder: 1,
            maxPerOrder: 2,
            isActive: true,
          },
        ],
      },
    ];

    // ─── Upsert events ────────────────────────────────────────────
    for (const eventDef of eventsData) {
      const { tiers, ...eventData } = eventDef;

      // Check if event with same title already exists
      const existing = await prisma.event.findFirst({
        where: { title: eventData.title },
        select: { id: true },
      });

      if (existing) {
        console.log(`  ⏭  Event "${eventData.title}" already exists (ID: ${existing.id}) — skipping.`);
        continue;
      }

      const event = await prisma.event.create({
        data: {
          ...eventData,
          organizerId: organizer.id,
          merchantId: merchant?.id ?? undefined,
          cityId: city?.id ?? undefined,
        },
      });
      console.log(`  ✅ Created event: "${event.title}" (ID: ${event.id})`);

      // Create ticket tiers
      for (const tier of tiers) {
        await prisma.eventTicketTier.create({
          data: {
            eventId: event.id,
            ...tier,
            reservedQuantity: tier.reservedQuantity ?? 0,
          },
        });
      }
      console.log(`     └─ Created ${tiers.length} ticket tier(s)`);
    }

    console.log('\n🎉 Event seeding complete!');
  } catch (error) {
    console.error('❌ Error seeding events:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedEvents();
