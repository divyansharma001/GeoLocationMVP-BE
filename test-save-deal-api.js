// test-save-deal-api.js
// Test script to demonstrate the Save Deal API functionality

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

// Example JWT token (you'll need to replace this with a real token from login)
const EXAMPLE_JWT_TOKEN = 'your-jwt-token-here';

// Test functions
async function testSaveDealAPI() {
  console.log('🧪 Testing Save Deal API...\n');

  try {
    // Test 1: Check if deal is saved (public endpoint)
    console.log('1. Testing public saved status check...');
    try {
      const publicResponse = await axios.get(`${BASE_URL}/deals/1/saved`);
      console.log('✅ Public saved status:', publicResponse.data);
    } catch (error) {
      console.log('❌ Public saved status error:', error.response?.data || error.message);
    }

    // Test 2: Check if deal is saved (authenticated endpoint)
    console.log('\n2. Testing authenticated saved status check...');
    try {
      const authResponse = await axios.get(`${BASE_URL}/user/deals/1/saved`, {
        headers: { 'Authorization': `Bearer ${EXAMPLE_JWT_TOKEN}` }
      });
      console.log('✅ Authenticated saved status:', authResponse.data);
    } catch (error) {
      console.log('❌ Authenticated saved status error:', error.response?.data || error.message);
    }

    // Test 3: Save a deal
    console.log('\n3. Testing save deal...');
    try {
      const saveResponse = await axios.post(`${BASE_URL}/user/deals/1/save`, {}, {
        headers: { 'Authorization': `Bearer ${EXAMPLE_JWT_TOKEN}` }
      });
      console.log('✅ Save deal response:', saveResponse.data);
    } catch (error) {
      console.log('❌ Save deal error:', error.response?.data || error.message);
    }

    // Test 4: Get all saved deals
    console.log('\n4. Testing get saved deals...');
    try {
      const savedDealsResponse = await axios.get(`${BASE_URL}/user/deals/saved`, {
        headers: { 'Authorization': `Bearer ${EXAMPLE_JWT_TOKEN}` }
      });
      console.log('✅ Saved deals response:', savedDealsResponse.data);
    } catch (error) {
      console.log('❌ Get saved deals error:', error.response?.data || error.message);
    }

    // Test 5: Remove a saved deal
    console.log('\n5. Testing remove saved deal...');
    try {
      const removeResponse = await axios.delete(`${BASE_URL}/user/deals/1/save`, {
        headers: { 'Authorization': `Bearer ${EXAMPLE_JWT_TOKEN}` }
      });
      console.log('✅ Remove saved deal response:', removeResponse.data);
    } catch (error) {
      console.log('❌ Remove saved deal error:', error.response?.data || error.message);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Helper function to get a real JWT token
async function getAuthToken() {
  console.log('🔑 To get a real JWT token, you can:');
  console.log('1. Register a user: POST /api/auth/register');
  console.log('2. Login: POST /api/auth/login');
  console.log('3. Use the returned token in the Authorization header\n');
  
  console.log('Example registration:');
  console.log(`curl -X POST ${BASE_URL}/auth/register \\`);
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"email":"test@example.com","password":"password123","name":"Test User"}\'\n');
  
  console.log('Example login:');
  console.log(`curl -X POST ${BASE_URL}/auth/login \\`);
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"email":"test@example.com","password":"password123"}\'\n');
}

// Run tests
console.log('🚀 Save Deal API Test Suite');
console.log('============================\n');

getAuthToken();
testSaveDealAPI();

console.log('\n📚 API Documentation:');
console.log('- Save a deal: POST /api/user/deals/:dealId/save');
console.log('- Remove saved deal: DELETE /api/user/deals/:dealId/save');
console.log('- Check if saved: GET /api/user/deals/:dealId/saved');
console.log('- Get all saved: GET /api/user/deals/saved');
console.log('- Public saved check: GET /api/deals/:dealId/saved');

console.log('\n📖 For detailed documentation, see: SAVE_DEAL_API_DOCUMENTATION.md');

