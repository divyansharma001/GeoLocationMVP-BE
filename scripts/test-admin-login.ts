import prisma from '../src/lib/prisma';
import bcrypt from 'bcryptjs';

async function testAdminLogin() {
  try {
    // Find the admin user
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@gmail.com' }
    });

    if (!adminUser) {
      console.log('❌ Admin user not found');
      return;
    }

    console.log('✅ Admin user found:');
    console.log(`Email: ${adminUser.email}`);
    console.log(`Role: ${adminUser.role}`);
    console.log(`Name: ${adminUser.name}`);
    console.log(`ID: ${adminUser.id}`);

    // Test password verification
    const passwordMatch = await bcrypt.compare('Admin@1234', adminUser.password);
    console.log(`Password verification: ${passwordMatch ? '✅ Valid' : '❌ Invalid'}`);

    if (passwordMatch) {
      console.log('\n🎉 Admin login credentials are working correctly!');
      console.log('You can now use these credentials to log into the admin dashboard:');
      console.log('Email: admin@gmail.com');
      console.log('Password: Admin@1234');
    }

  } catch (error) {
    console.error('❌ Error testing admin login:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAdminLogin();
