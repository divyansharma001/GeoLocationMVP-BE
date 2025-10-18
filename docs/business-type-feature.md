# Business Type Feature

## Overview
Added the ability to distinguish between **National chains** (e.g., McDonald's) and **Local businesses** (e.g., local restaurants) in the merchant registration and management system.

## Changes Made

### 1. Database Schema (`prisma/schema.prisma`)

#### New Enum
```prisma
enum BusinessType {
  NATIONAL
  LOCAL
}
```

#### Updated Merchant Model
Added `businessType` field to the `Merchant` model:
```prisma
model Merchant {
  // ... existing fields
  businessType  BusinessType @default(LOCAL) // National chain or local business
  // ... rest of fields
}
```

**Default Value**: `LOCAL` - All existing merchants will default to `LOCAL` type.

### 2. Migration
Created migration: `20251018063539_add_business_type_to_merchant`
- Adds `BusinessType` enum to the database
- Adds `businessType` column to the `Merchant` table with default value `LOCAL`
- All existing merchants automatically set to `LOCAL`

### 3. API Updates

#### Merchant Registration (`POST /api/merchants/register`)
**New Field**: `businessType` (optional)
- Accepts: `"NATIONAL"` or `"LOCAL"`
- Default: `"LOCAL"` if not provided
- Validation: Returns 400 error if an invalid value is provided

**Updated Request Body**:
```json
{
  "businessName": "Joe's Pizza",
  "address": "123 Main St, New York, NY",
  "description": "Best pizza in town",
  "logoUrl": "https://example.com/logo.jpg",
  "phoneNumber": "+1-555-123-4567",
  "businessType": "LOCAL",  // NEW FIELD
  "latitude": 40.7128,
  "longitude": -74.0060,
  "cityId": 1
}
```

#### Updated Endpoints
The `businessType` field is now included in responses for the following endpoints:

1. **GET /api/merchants/status** - Returns merchant status with business type
2. **PUT /api/merchants/coordinates** - Returns updated merchant with business type
3. **GET /api/deals** - Deal responses include merchant business type
4. **POST /api/deals/:dealId/share** - Share data includes merchant business type
5. **GET /api/cities/:cityId/stores** - Store listings include merchant business type
6. **Admin endpoints** - All merchant listings include business type

### 4. Documentation
Updated `API_DOCUMENTATION.md` to include the new `businessType` field in the merchant registration example.

## Usage Examples

### Registering a National Chain
```json
POST /api/merchants/register
{
  "businessName": "McDonald's",
  "businessType": "NATIONAL",
  "address": "456 Chain Ave, New York, NY",
  "cityId": 1
}
```

### Registering a Local Business
```json
POST /api/merchants/register
{
  "businessName": "Joe's Local Pizza",
  "businessType": "LOCAL",
  "address": "123 Main St, New York, NY",
  "cityId": 1
}
```

### Backward Compatibility
If `businessType` is not provided during registration, it defaults to `"LOCAL"`:
```json
POST /api/merchants/register
{
  "businessName": "New Restaurant",
  "address": "789 Food St, New York, NY",
  "cityId": 1
  // businessType will default to "LOCAL"
}
```

## Database Impact
- All existing merchants have been automatically assigned `businessType: "LOCAL"`
- No data loss or breaking changes
- The field is required at the database level but has a default value

## Future Enhancements
Potential features that could leverage this field:
- Filter deals by business type (show only local businesses)
- Different analytics/reporting for national chains vs local businesses
- Promotional features specific to local businesses
- Chain management features for national brands (multi-location management)
- Location-based insights comparing national vs local business performance
