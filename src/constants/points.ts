/**
 * Point Event Type Constants
 *
 * These IDs correspond to the PointEventTypeMaster table in the database.
 * Using constants instead of magic numbers improves code readability and maintainability.
 */
export const POINT_EVENT_TYPES = {
  SIGNUP: 1,
  FIRST_CHECKIN_DEAL: 2,
  CHECKIN: 3,
  COIN_PURCHASE: 4,
  ACHIEVEMENT_UNLOCK: 5,
  LOYALTY_BONUS: 6,
  REFERRAL_BONUS: 7,
  HEIST_GAIN: 8,
  HEIST_LOSS: 9,
} as const;

/**
 * Default Point Values
 *
 * These can be overridden by environment variables via getPointConfig()
 */
export const DEFAULT_POINTS = {
  SIGNUP: 50,
  CHECKIN: 10,
  FIRST_CHECKIN_BONUS: 25,
  REFERRAL_BONUS: 100,
} as const;

/**
 * Check-in Configuration
 */
export const CHECKIN_CONFIG = {
  /** Default radius in meters for check-in validation */
  RADIUS_METERS: 100,
  /** Earth's radius in kilometers for distance calculations */
  EARTH_RADIUS_KM: 6371,
  /** Earth's radius in meters for distance calculations */
  EARTH_RADIUS_METERS: 6371000,
} as const;

/**
 * Loyalty Tier Thresholds (in dollars spent)
 */
export const LOYALTY_TIERS = {
  BRONZE: 0,
  SILVER: 50,
  GOLD: 150,
  PLATINUM: 300,
  DIAMOND: 500,
} as const;

/**
 * Loyalty Tier Coin Multipliers
 */
export const TIER_MULTIPLIERS = {
  BRONZE: 1.0,
  SILVER: 1.2,
  GOLD: 1.5,
  PLATINUM: 1.8,
  DIAMOND: 2.0,
} as const;

export type PointEventType = typeof POINT_EVENT_TYPES[keyof typeof POINT_EVENT_TYPES];
export type LoyaltyTier = keyof typeof LOYALTY_TIERS;
