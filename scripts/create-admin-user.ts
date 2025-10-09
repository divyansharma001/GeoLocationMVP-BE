import prisma from '../src/lib/prisma';
import bcrypt from 'bcryptjs';

async function createAdminUser() {
  try {
    // Check if admin user already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'admin@gmail.com' }
    });

    if (existingAdmin) {
      console.log('Admin user already exists, updating password...');
      
      // Update the existing admin user
      const hashedPassword = await bcrypt.hash('Admin@1234', 10);
      const updatedAdmin = await prisma.user.update({
        where: { email: 'admin@gmail.com' },
        data: {
          password: hashedPassword,
          role: 'ADMIN',
          name: 'Admin User'
        }
      });
      
      console.log('✅ Admin user updated successfully!');
      console.log(`Email: ${updatedAdmin.email}`);
      console.log(`Role: ${updatedAdmin.role}`);
      console.log(`Name: ${updatedAdmin.name}`);
      
    } else {
      // Create new admin user
      const hashedPassword = await bcrypt.hash('Admin@1234', 10);
      
      const adminUser = await prisma.user.create({
        data: {
          email: 'admin@gmail.com',
          password: hashedPassword,
          role: 'ADMIN',
          name: 'Admin User'
        }
      });
      
      console.log('✅ Admin user created successfully!');
      console.log(`Email: ${adminUser.email}`);
      console.log(`Role: ${adminUser.role}`);
      console.log(`Name: ${adminUser.name}`);
    }
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser();
