# Gamification System Setup & Testing Guide

## 🎮 Overview

A complete full-stack gamification system has been implemented with:
- **Virtual Coins System** - Users can earn and purchase coins
- **Loyalty Tiers** - Bronze, Silver, Gold, Platinum, Diamond
- **Achievement System** - Various achievements with coin/XP rewards
- **PayPal Integration** - Sandbox payments for coin purchases
- **Transaction History** - Complete audit trail of all coin activities

## 🛠️ Backend Setup

### 1. Database Migration
The gamification schema has been added to your Prisma schema. If you haven't already:

```bash
cd GeoLocationMVP-BE
npx prisma migrate deploy
npx prisma generate
```

### 2. Seed Gamification Data
```bash
npm run seed:gamification
```

This creates:
- 10 predefined achievements
- 5 loyalty tier configurations with benefits
- Proper coin multipliers and rewards

### 3. Environment Variables
Your `.env` should contain the PayPal credentials:
```env
PAYPAL_CLIENT_ID=your_paypal_client_id_here
PAYPAL_SECRET_KEY=your_paypal_secret_key_here
```

### 4. Start Backend Server
```bash
npm run dev
```

## 🌐 Frontend Setup

### 1. Environment Variables
Your frontend `.env` is configured:
```env
VITE_API_URL=http://localhost:3000/api
VITE_PAYPAL_CLIENT_ID=ATh1izwcWlkZAhwvoonywXBhc5vbhcOFu6XPMtOqjhr441R_chEwXalycezpSqyprTa55RmiLHK1ZOa1
```

### 2. Start Frontend Server
```bash
cd ../Geolocation-MVP/web
npm run dev
```

## 🎯 API Endpoints

### Gamification Routes (All require authentication)
- `GET /api/gamification/profile` - User's gamification profile
- `GET /api/gamification/transactions` - Coin transaction history
- `GET /api/gamification/coin-packages` - Available coin packages
- `POST /api/gamification/purchase/create-order` - Create PayPal order
- `POST /api/gamification/purchase/capture` - Capture PayPal payment
- `GET /api/gamification/achievements` - User achievements
- `GET /api/gamification/loyalty-tiers` - Loyalty tier information
- `GET /api/gamification/payments` - Payment history
- `POST /api/gamification/dev/award-coins` - Award coins (dev only)

## 🧪 Testing the System

### 1. Basic Functionality Test
1. Register/login a user
2. Navigate to the gamification dashboard
3. Check initial profile (0 coins, Bronze tier)

### 2. Test Coin Purchase (PayPal Sandbox)
1. Go to "Buy Coins" tab
2. Select a coin package
3. Click "Buy Coins"
4. Use PayPal sandbox test account:
   - **Email**: sb-buyer@business.example.com
   - **Password**: test123
5. Complete payment
6. Verify coins are added to account

### 3. Test Achievement System
- Awards automatically trigger on certain actions
- Check "Achievements" tab to see progress
- Completed achievements show rewards earned

### 4. Test Loyalty System
- Spend money to increase loyalty tier
- Higher tiers give coin multipliers
- Check "Loyalty Progress" section

### 5. Test Transaction History
- All coin activities are logged
- Check "Transactions" tab for audit trail
- See balance changes for each transaction

## 🎮 UI Components Created

### Main Components
- `GamificationDashboard` - Main dashboard with stats and tabs
- `CoinPurchase` - PayPal integration for buying coins
- `AchievementsList` - Display achievements with progress
- `TransactionHistory` - Paginated coin transaction history
- `PaymentHistory` - PayPal payment records
- `CoinDisplay` - Simple coin balance display

### React Hooks
- `useGamificationProfile` - User's gamification data
- `useCoinTransactions` - Transaction history with pagination
- `useAchievements` - Achievement data and progress
- `useCoinPackages` - Available coin packages
- `usePaymentHistory` - PayPal payment records
- `useCreatePaymentOrder` - Create PayPal orders
- `useCapturePayment` - Process PayPal payments

## 💎 Gamification Features

### Coin System
- **Earning**: Check-ins, achievements, referrals, purchases
- **Spending**: Future integration with deals and rewards
- **Multipliers**: Loyalty tiers provide bonus earning rates
- **Packages**: 5 coin packages from $0.99 to $39.99

### Loyalty Tiers
- **Bronze** (0+): 1x coins, 0% discount
- **Silver** ($50+): 1.2x coins, 5% discount
- **Gold** ($150+): 1.5x coins, 10% discount
- **Platinum** ($300+): 1.8x coins, 15% discount
- **Diamond** ($500+): 2x coins, 20% discount

### Achievement Types
- **First Purchase**: Welcome achievements
- **Spending Milestones**: Reward big spenders
- **Check-in Streaks**: Encourage regular usage
- **Referral Rewards**: Viral growth incentives
- **Deal Saving**: Engagement rewards
- **Loyalty Tiers**: Tier upgrade bonuses

## 🔧 Development Tools

### Test Coin Awards (Development Mode)
```bash
# Award coins via API (only in development)
POST /api/gamification/dev/award-coins
{
  "amount": 100,
  "type": "EARNED",
  "description": "Test coins"
}
```

### PayPal Sandbox Testing
- Use the provided sandbox client ID
- Test accounts are available in PayPal Developer Dashboard
- All payments are simulated (no real money)

## 🚀 Production Migration

To migrate to production:

1. **Update PayPal credentials** in backend `.env`:
   - Replace with live PayPal client ID and secret
   - Update frontend `VITE_PAYPAL_CLIENT_ID`

2. **Update environment settings**:
   - Set `NODE_ENV=production`
   - Configure proper CORS origins
   - Update database to production instance

3. **Deploy with proper security**:
   - Enable HTTPS
   - Secure API endpoints
   - Implement rate limiting

## 📊 Architecture Benefits

### Modular Design
- Separate concerns (coins, achievements, payments)
- Easy to extend with new features
- Database schema supports complex gamification

### Scalable Structure
- Paginated APIs for large datasets
- Efficient database queries with indexes
- React Query for optimized caching

### Production Ready
- Comprehensive error handling
- Transaction safety with Prisma
- Audit trail for all coin activities
- PayPal integration follows best practices

## 🎉 Ready to Test!

Your gamification system is now fully implemented and ready for testing. Start both servers and explore the features through the gamification dashboard!