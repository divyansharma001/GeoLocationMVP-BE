import prisma from '../src/lib/prisma';

async function fixPointEventTypes() {
  try {
    console.log('🔧 Fixing PointEventTypeMaster records...\n');

    // Define the required point event types
    const requiredPointEventTypes = [
      {
        name: 'SIGNUP',
        description: 'Points awarded for user signup',
        points: 100,
        active: true
      },
      {
        name: 'FIRST_CHECKIN_DEAL',
        description: 'Points awarded for first deal check-in',
        points: 50,
        active: true
      },
      {
        name: 'CHECKIN',
        description: 'Points awarded for regular deal check-ins',
        points: 10,
        active: true
      }
    ];

    // Check existing point event types
    const existingTypes = await prisma.pointEventTypeMaster.findMany();
    console.log(`📊 Found ${existingTypes.length} existing point event types:`);
    existingTypes.forEach(type => {
      console.log(`  - ID: ${type.id}, Name: ${type.name}, Points: ${type.points}`);
    });

    // Create missing point event types
    for (const pointEventType of requiredPointEventTypes) {
      const existing = await prisma.pointEventTypeMaster.findFirst({
        where: { name: pointEventType.name }
      });

      if (existing) {
        console.log(`✅ Point event type '${pointEventType.name}' already exists (ID: ${existing.id})`);
      } else {
        const created = await prisma.pointEventTypeMaster.create({
          data: pointEventType
        });
        console.log(`➕ Created point event type '${pointEventType.name}' with ID: ${created.id}`);
      }
    }

    // Verify all required types exist
    const finalTypes = await prisma.pointEventTypeMaster.findMany();
    console.log(`\n📋 Final point event types (${finalTypes.length} total):`);
    finalTypes.forEach(type => {
      console.log(`  - ID: ${type.id}, Name: ${type.name}, Points: ${type.points}, Active: ${type.active}`);
    });

    console.log('\n✅ Point event types fix completed successfully!');

  } catch (error) {
    console.error('❌ Error fixing point event types:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixPointEventTypes();
