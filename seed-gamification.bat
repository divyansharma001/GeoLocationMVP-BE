#!/bin/bash

# Quick script to seed gamification data
echo "🎮 Seeding gamification data..."

# Navigate to the backend directory
cd "c:\Users\HP\OneDrive\Desktop\rajudivfolder\GeoLocationMVP-BE"

# Run the seed script
npx ts-node scripts/seed-gamification.ts

echo "✅ Gamification data seeded successfully!"
echo "🚀 You can now test the payment system!"