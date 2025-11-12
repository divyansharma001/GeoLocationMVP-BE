/**
 * Heist Token Configuration
 * 
 * Centralized configuration management for the heist token feature.
 * All tunable parameters are loaded from environment variables with safe defaults.
 */

export interface HeistConfig {
  // Feature flag
  enabled: boolean;

  // Token economics
  tokensPerReferral: number;
  tokenCost: number;

  // Heist mechanics
  stealPercentage: number;
  maxPointsPerHeist: number;
  minVictimPoints: number;

  // Cooldowns (in hours)
  attackerCooldown: number;
  victimProtection: number;

  // Rate limiting
  maxHeistsPerDay: number;

  // Notifications
  emailsEnabled: boolean;

  // Item system
  itemsEnabled: boolean;
  minProtectionPercentage: number;
}

/**
 * Get the current heist configuration from environment variables
 */
export function getHeistConfig(): HeistConfig {
  return {
    // Feature flag - can disable entire feature instantly
    enabled: process.env.HEIST_ENABLED !== 'false', // Default: true

    // Token economics
    tokensPerReferral: parseInt(process.env.HEIST_TOKENS_PER_REFERRAL || '1', 10),
    tokenCost: parseInt(process.env.HEIST_TOKEN_COST || '1', 10),

    // Heist mechanics
    stealPercentage: parseFloat(process.env.HEIST_STEAL_PERCENTAGE || '0.05'), // 5%
    maxPointsPerHeist: parseInt(process.env.HEIST_MAX_POINTS || '100', 10),
    minVictimPoints: parseInt(process.env.HEIST_MIN_VICTIM_POINTS || '20', 10),

    // Cooldowns (converted to hours)
    attackerCooldown: parseInt(process.env.HEIST_ATTACKER_COOLDOWN_HOURS || '24', 10),
    victimProtection: parseInt(process.env.HEIST_VICTIM_PROTECTION_HOURS || '48', 10),

    // Rate limiting
    maxHeistsPerDay: parseInt(process.env.HEIST_MAX_PER_DAY || '10', 10),

    // Notifications
    emailsEnabled: process.env.HEIST_EMAILS_ENABLED === 'true', // Default: false

    // Item system
    itemsEnabled: process.env.HEIST_ITEMS_ENABLED !== 'false', // Default: true
    minProtectionPercentage: parseFloat(process.env.HEIST_MIN_PROTECTION_PERCENTAGE || '0.10'), // 10%
  };
}

/**
 * Validate the configuration values are within acceptable ranges
 */
export function validateConfig(config: HeistConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate steal percentage
  if (config.stealPercentage <= 0 || config.stealPercentage > 0.5) {
    errors.push('HEIST_STEAL_PERCENTAGE must be between 0 and 0.5 (0% to 50%)');
  }

  // Validate max points
  if (config.maxPointsPerHeist <= 0 || config.maxPointsPerHeist > 1000) {
    errors.push('HEIST_MAX_POINTS must be between 1 and 1000');
  }

  // Validate min victim points
  if (config.minVictimPoints < 0) {
    errors.push('HEIST_MIN_VICTIM_POINTS must be non-negative');
  }

  // Validate cooldowns
  if (config.attackerCooldown < 0) {
    errors.push('HEIST_ATTACKER_COOLDOWN_HOURS must be non-negative');
  }
  if (config.victimProtection < 0) {
    errors.push('HEIST_VICTIM_PROTECTION_HOURS must be non-negative');
  }

  // Validate tokens
  if (config.tokensPerReferral <= 0) {
    errors.push('HEIST_TOKENS_PER_REFERRAL must be positive');
  }
  if (config.tokenCost <= 0) {
    errors.push('HEIST_TOKEN_COST must be positive');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate points to steal based on configuration
 */
export function calculatePointsToSteal(victimMonthlyPoints: number, config: HeistConfig): number {
  const percentageAmount = Math.floor(victimMonthlyPoints * config.stealPercentage);
  return Math.min(percentageAmount, config.maxPointsPerHeist);
}

/**
 * Convert hours to milliseconds for date comparisons
 */
export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}
